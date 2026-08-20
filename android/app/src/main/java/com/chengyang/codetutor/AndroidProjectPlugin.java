package com.chengyang.codetutor;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

@CapacitorPlugin(name = "AndroidProject")
public class AndroidProjectPlugin extends Plugin {
    private static final String PREFS_NAME = "code_tutor_android_project";
    private static final String PREF_TREE_URI = "tree_uri";
    private static final String PREF_API_KEY_CIPHERTEXT =
        "openai_key_ciphertext";
    private static final String PREF_API_KEY_IV =
        "openai_key_iv";
    private static final String API_KEYSTORE_ALIAS =
        "code_tutor_openai_key_v1";

    private static String pendingGitHubUrl = "";

    private static final int MAX_VISIBLE_FILES = 5000;
    private static final int MAX_SCANNED_DOCUMENTS = 12000;
    private static final int MAX_TEXT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ASSET_BYTES = 12 * 1024 * 1024;

    private static final Set<String> IGNORED_DIRECTORIES = new HashSet<>(
        Arrays.asList(
            ".git",
            ".dart_tool",
            ".gradle",
            ".idea",
            ".next",
            ".nuxt",
            "node_modules",
            "build",
            "dist",
            "coverage"
        )
    );

    private static final Set<String> TEXT_EXTENSIONS = new HashSet<>(
        Arrays.asList(
            ".c", ".cc", ".cpp", ".cs", ".css", ".dart", ".env", ".go",
            ".gradle", ".h", ".hpp", ".html", ".java", ".js", ".jsx",
            ".json", ".kt", ".kts", ".less", ".mjs", ".cjs", ".md",
            ".php", ".prisma", ".py", ".rb", ".rs", ".scss", ".sh",
            ".sql", ".svelte", ".swift", ".toml", ".ts", ".tsx", ".txt",
            ".vue", ".xml", ".yaml", ".yml", ".properties", ".lock"
        )
    );

    private final Map<String, Uri> documentUris = new HashMap<>();
    private final Map<String, Uri> directoryUris = new HashMap<>();
    private Uri currentTreeUri;

    public static synchronized void setPendingGitHubUrl(
        String url
    ) {
        pendingGitHubUrl =
            url == null
                ? ""
                : url.trim();
    }

    @PluginMethod
    public void takePendingGitHubUrl(
        PluginCall call
    ) {
        JSObject result = new JSObject();

        synchronized (AndroidProjectPlugin.class) {
            result.put("url", pendingGitHubUrl);
            pendingGitHubUrl = "";
        }

        call.resolve(result);
    }

    @PluginMethod
    public void openProject(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );

        startActivityForResult(call, intent, "projectDirectoryPicked");
    }

    @ActivityCallback
    private void projectDirectoryPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        Intent data = result.getData();
        if (
            result.getResultCode() != Activity.RESULT_OK
                || data == null
                || data.getData() == null
        ) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri treeUri = data.getData();
        ContentResolver resolver = getContext().getContentResolver();

        int takeFlags = data.getFlags()
            & (
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );

        try {
            resolver.takePersistableUriPermission(treeUri, takeFlags);
        } catch (SecurityException ignored) {
            // Some providers grant access for the current session but do not
            // support persisted grants. The selected project still works now.
        }

        prefs()
            .edit()
            .putString(PREF_TREE_URI, treeUri.toString())
            .apply();

        try {
            call.resolve(loadProject(treeUri));
        } catch (Exception error) {
            call.reject(
                "读取 Android 项目目录失败：" + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void restoreProject(PluginCall call) {
        String saved = prefs().getString(PREF_TREE_URI, "");
        if (saved == null || saved.isEmpty()) {
            JSObject none = new JSObject();
            none.put("cancelled", true);
            call.resolve(none);
            return;
        }

        try {
            call.resolve(loadProject(Uri.parse(saved)));
        } catch (Exception error) {
            prefs().edit().remove(PREF_TREE_URI).apply();
            JSObject none = new JSObject();
            none.put("cancelled", true);
            call.resolve(none);
        }
    }

    @PluginMethod
    public void readProjectFile(PluginCall call) {
        String path = normalizeRelativePath(call.getString("path"));
        if (path.isEmpty()) {
            call.reject("文件路径不能为空。");
            return;
        }

        try {
            Uri uri = requireDocumentUri(path);
            byte[] bytes = readBytes(uri, MAX_TEXT_BYTES);
            JSObject ret = new JSObject();
            ret.put("path", path);
            ret.put("content", new String(bytes, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception error) {
            call.reject(
                "读取文件失败：" + path + " · " + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void writeProjectFile(PluginCall call) {
        String path = normalizeRelativePath(call.getString("path"));
        String content = call.getString("content", "");

        if (path.isEmpty()) {
            call.reject("文件路径不能为空。");
            return;
        }

        try {
            Uri uri = requireDocumentUri(path);
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);

            try (
                OutputStream output = getContext()
                    .getContentResolver()
                    .openOutputStream(uri, "wt")
            ) {
                if (output == null) {
                    throw new IOException("系统无法打开文件输出流。");
                }
                output.write(bytes);
                output.flush();
            }

            JSObject ret = new JSObject();
            ret.put("path", path);
            ret.put("bytes", bytes.length);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject(
                "保存文件失败：" + path + " · " + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void readProjectAsset(PluginCall call) {
        String path = normalizeRelativePath(call.getString("path"));
        if (path.isEmpty()) {
            call.reject("资源路径不能为空。");
            return;
        }

        try {
            Uri uri = requireDocumentUri(path);
            byte[] bytes = readBytes(uri, MAX_ASSET_BYTES);
            String mimeType = getContext()
                .getContentResolver()
                .getType(uri);

            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = guessMimeType(path);
            }

            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject ret = new JSObject();
            ret.put("path", path);
            ret.put("mimeType", mimeType);
            ret.put(
                "dataUrl",
                "data:" + mimeType + ";base64," + base64
            );
            call.resolve(ret);
        } catch (Exception error) {
            call.reject(
                "读取资源失败：" + path + " · " + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void writeClipboard(
        PluginCall call
    ) {
        String text =
            call.getString("text", "");

        ClipboardManager clipboard =
            (ClipboardManager)
                getContext().getSystemService(
                    Context.CLIPBOARD_SERVICE
                );

        if (clipboard == null) {
            call.reject("Clipboard unavailable.");
            return;
        }

        clipboard.setPrimaryClip(
            ClipData.newPlainText(
                "Code Tutor IDE",
                text
            )
        );

        JSObject result = new JSObject();
        result.put("value", true);
        call.resolve(result);
    }

    @PluginMethod
    public void readClipboard(
        PluginCall call
    ) {
        ClipboardManager clipboard =
            (ClipboardManager)
                getContext().getSystemService(
                    Context.CLIPBOARD_SERVICE
                );

        if (clipboard == null) {
            call.reject("Clipboard unavailable.");
            return;
        }

        String text = "";
        ClipData clip =
            clipboard.getPrimaryClip();

        if (
            clip != null
                && clip.getItemCount() > 0
        ) {
            CharSequence value =
                clip.getItemAt(0)
                    .coerceToText(
                        getContext()
                    );

            if (value != null) {
                text = value.toString();
            }
        }

        JSObject result = new JSObject();
        result.put("text", text);
        call.resolve(result);
    }

    @PluginMethod
    public void createProjectFile(
        PluginCall call
    ) {
        String path = normalizeRelativePath(
            call.getString("path")
        );

        if (path.isEmpty()) {
            call.reject("文件路径不能为空。");
            return;
        }

        try {
            ensureProjectLoaded();

            if (
                documentUris.containsKey(path)
                    || directoryUris.containsKey(path)
            ) {
                throw new IOException(
                    "同名文件或文件夹已经存在：" + path
                );
            }

            Uri created =
                DocumentsContract.createDocument(
                    getContext()
                        .getContentResolver(),
                    requireDirectoryUri(
                        parentPath(path)
                    ),
                    guessTextMimeType(path),
                    baseName(path)
                );

            if (created == null) {
                throw new IOException(
                    "系统没有创建文件。"
                );
            }

            JSObject result =
                loadProject(currentTreeUri);
            result.put("createdPath", path);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "创建文件失败：" + path
                    + " · "
                    + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void createProjectDirectory(
        PluginCall call
    ) {
        String path = normalizeRelativePath(
            call.getString("path")
        );

        if (path.isEmpty()) {
            call.reject("文件夹路径不能为空。");
            return;
        }

        try {
            ensureProjectLoaded();

            if (
                documentUris.containsKey(path)
                    || directoryUris.containsKey(path)
            ) {
                throw new IOException(
                    "同名文件或文件夹已经存在：" + path
                );
            }

            Uri created =
                DocumentsContract.createDocument(
                    getContext()
                        .getContentResolver(),
                    requireDirectoryUri(
                        parentPath(path)
                    ),
                    DocumentsContract.Document
                        .MIME_TYPE_DIR,
                    baseName(path)
                );

            if (created == null) {
                throw new IOException(
                    "系统没有创建文件夹。"
                );
            }

            JSObject result =
                loadProject(currentTreeUri);
            result.put("createdPath", path);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "创建文件夹失败：" + path
                    + " · "
                    + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void hasOpenAiKey(
        PluginCall call
    ) {
        JSObject result = new JSObject();

        try {
            String ciphertext =
                prefs().getString(
                    PREF_API_KEY_CIPHERTEXT,
                    ""
                );
            String iv =
                prefs().getString(
                    PREF_API_KEY_IV,
                    ""
                );

            KeyStore keyStore =
                KeyStore.getInstance(
                    "AndroidKeyStore"
                );
            keyStore.load(null);

            result.put(
                "value",
                ciphertext != null
                    && !ciphertext.isEmpty()
                    && iv != null
                    && !iv.isEmpty()
                    && keyStore.containsAlias(
                        API_KEYSTORE_ALIAS
                    )
            );
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "检查 Android 安全 API Key 失败："
                    + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void setOpenAiKey(
        PluginCall call
    ) {
        String apiKey =
            call.getString("apiKey", "").trim();

        if (apiKey.isEmpty()) {
            call.reject("API Key 不能为空。");
            return;
        }

        try {
            SecretKey key =
                getOrCreateApiEncryptionKey();

            Cipher cipher =
                Cipher.getInstance(
                    "AES/GCM/NoPadding"
                );
            cipher.init(
                Cipher.ENCRYPT_MODE,
                key
            );

            byte[] encrypted =
                cipher.doFinal(
                    apiKey.getBytes(
                        StandardCharsets.UTF_8
                    )
                );

            prefs()
                .edit()
                .putString(
                    PREF_API_KEY_CIPHERTEXT,
                    Base64.encodeToString(
                        encrypted,
                        Base64.NO_WRAP
                    )
                )
                .putString(
                    PREF_API_KEY_IV,
                    Base64.encodeToString(
                        cipher.getIV(),
                        Base64.NO_WRAP
                    )
                )
                .apply();

            JSObject result = new JSObject();
            result.put("value", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "Android Keystore 保存 API Key 失败："
                    + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void clearOpenAiKey(
        PluginCall call
    ) {
        try {
            prefs()
                .edit()
                .remove(
                    PREF_API_KEY_CIPHERTEXT
                )
                .remove(PREF_API_KEY_IV)
                .apply();

            KeyStore keyStore =
                KeyStore.getInstance(
                    "AndroidKeyStore"
                );
            keyStore.load(null);

            if (
                keyStore.containsAlias(
                    API_KEYSTORE_ALIAS
                )
            ) {
                keyStore.deleteEntry(
                    API_KEYSTORE_ALIAS
                );
            }

            JSObject result = new JSObject();
            result.put("value", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "清除 Android 安全 API Key 失败："
                    + safeMessage(error),
                error
            );
        }
    }

    private SecretKey getOrCreateApiEncryptionKey()
        throws Exception {
        KeyStore keyStore =
            KeyStore.getInstance(
                "AndroidKeyStore"
            );
        keyStore.load(null);

        if (
            keyStore.containsAlias(
                API_KEYSTORE_ALIAS
            )
        ) {
            return (SecretKey)
                keyStore.getKey(
                    API_KEYSTORE_ALIAS,
                    null
                );
        }

        KeyGenerator generator =
            KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
            );

        generator.init(
            new KeyGenParameterSpec.Builder(
                API_KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT
                    | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(
                    KeyProperties.BLOCK_MODE_GCM
                )
                .setEncryptionPaddings(
                    KeyProperties
                        .ENCRYPTION_PADDING_NONE
                )
                .setKeySize(256)
                .build()
        );

        return generator.generateKey();
    }

    private void ensureProjectLoaded()
        throws Exception {
        if (currentTreeUri != null) {
            return;
        }

        String saved =
            prefs().getString(
                PREF_TREE_URI,
                ""
            );

        if (
            saved == null
                || saved.isEmpty()
        ) {
            throw new IOException(
                "请先打开 Android 项目目录。"
            );
        }

        loadProject(Uri.parse(saved));
    }

    private String parentPath(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0
            ? ""
            : path.substring(0, slash);
    }

    private String baseName(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0
            ? path
            : path.substring(slash + 1);
    }

    private Uri requireDirectoryUri(
        String path
    ) throws Exception {
        ensureProjectLoaded();

        Uri uri = directoryUris.get(path);
        if (uri == null) {
            throw new IOException(
                "项目中找不到文件夹：" + path
            );
        }

        return uri;
    }

    private JSObject loadProject(Uri treeUri) throws Exception {
        currentTreeUri = treeUri;
        documentUris.clear();
        directoryUris.clear();

        String rootDocumentId =
            DocumentsContract.getTreeDocumentId(
                treeUri
            );
        Uri rootDocumentUri =
            DocumentsContract
                .buildDocumentUriUsingTree(
                    treeUri,
                    rootDocumentId
                );
        directoryUris.put(
            "",
            rootDocumentUri
        );
        String projectName = readDisplayName(
            DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                rootDocumentId
            )
        );

        if (projectName == null || projectName.trim().isEmpty()) {
            projectName = "Android Project";
        }

        List<String> visibleFiles =
            new ArrayList<>();
        List<String> visibleDirectories =
            new ArrayList<>();
        int[] scannedCount = new int[] { 0 };

        walkDirectory(
            treeUri,
            rootDocumentId,
            "",
            visibleFiles,
            visibleDirectories,
            scannedCount
        );

        Collections.sort(
            visibleFiles,
            String.CASE_INSENSITIVE_ORDER
        );
        Collections.sort(
            visibleDirectories,
            String.CASE_INSENSITIVE_ORDER
        );

        JSArray files = new JSArray();
        for (String file : visibleFiles) {
            files.put(file);
        }

        JSArray directories =
            new JSArray();
        for (
            String directory :
            visibleDirectories
        ) {
            directories.put(directory);
        }

        JSObject ret = new JSObject();
        ret.put("cancelled", false);
        ret.put("rootPath", treeUri.toString());
        ret.put("projectName", projectName);
        ret.put("files", files);
        ret.put("directories", directories);
        ret.put("lastOpenFile", "");
        return ret;
    }

    private void walkDirectory(
        Uri treeUri,
        String parentDocumentId,
        String prefix,
        List<String> visibleFiles,
        List<String> visibleDirectories,
        int[] scannedCount
    ) throws Exception {
        if (
            visibleFiles.size() >= MAX_VISIBLE_FILES
                || scannedCount[0] >= MAX_SCANNED_DOCUMENTS
        ) {
            return;
        }

        Uri childrenUri =
            DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri,
                parentDocumentId
            );

        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };

        try (
            Cursor cursor = getContext()
                .getContentResolver()
                .query(
                    childrenUri,
                    projection,
                    null,
                    null,
                    null
                )
        ) {
            if (cursor == null) {
                return;
            }

            int idIndex = cursor.getColumnIndexOrThrow(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID
            );
            int nameIndex = cursor.getColumnIndexOrThrow(
                DocumentsContract.Document.COLUMN_DISPLAY_NAME
            );
            int mimeIndex = cursor.getColumnIndexOrThrow(
                DocumentsContract.Document.COLUMN_MIME_TYPE
            );

            while (cursor.moveToNext()) {
                if (
                    visibleFiles.size() >= MAX_VISIBLE_FILES
                        || scannedCount[0] >= MAX_SCANNED_DOCUMENTS
                ) {
                    break;
                }

                scannedCount[0] += 1;

                String documentId = cursor.getString(idIndex);
                String displayName = cursor.getString(nameIndex);
                String mimeType = cursor.getString(mimeIndex);

                if (
                    displayName == null
                        || displayName.isEmpty()
                        || documentId == null
                ) {
                    continue;
                }

                String relativePath = prefix.isEmpty()
                    ? displayName
                    : prefix + "/" + displayName;

                if (
                    DocumentsContract.Document
                        .MIME_TYPE_DIR
                        .equals(mimeType)
                ) {
                    if (
                        IGNORED_DIRECTORIES.contains(
                            displayName.toLowerCase(Locale.ROOT)
                        )
                    ) {
                        continue;
                    }

                    Uri directoryUri =
                        DocumentsContract
                            .buildDocumentUriUsingTree(
                                treeUri,
                                documentId
                            );
                    directoryUris.put(
                        relativePath,
                        directoryUri
                    );
                    visibleDirectories.add(
                        relativePath
                    );

                    walkDirectory(
                        treeUri,
                        documentId,
                        relativePath,
                        visibleFiles,
                        visibleDirectories,
                        scannedCount
                    );
                    continue;
                }

                Uri documentUri =
                    DocumentsContract.buildDocumentUriUsingTree(
                        treeUri,
                        documentId
                    );

                documentUris.put(relativePath, documentUri);

                if (isVisibleTextFile(relativePath)) {
                    visibleFiles.add(relativePath);
                }
            }
        }
    }

    private boolean isVisibleTextFile(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        String fileName = lower.substring(
            lower.lastIndexOf('/') + 1
        );

        if (
            fileName.equals("dockerfile")
                || fileName.equals("makefile")
                || fileName.equals("pubspec.yaml")
                || fileName.equals("package.json")
                || fileName.equals("package-lock.json")
        ) {
            return true;
        }

        int dot = fileName.lastIndexOf('.');
        if (dot < 0) {
            return false;
        }

        return TEXT_EXTENSIONS.contains(
            fileName.substring(dot)
        );
    }

    private String readDisplayName(Uri uri) {
        try (
            Cursor cursor = getContext()
                .getContentResolver()
                .query(
                    uri,
                    new String[] {
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME
                    },
                    null,
                    null,
                    null
                )
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
            // Fallback below.
        }

        return "Android Project";
    }

    private Uri requireDocumentUri(String path) throws Exception {
        Uri uri = documentUris.get(path);
        if (uri != null) {
            return uri;
        }

        if (currentTreeUri == null) {
            String saved = prefs().getString(PREF_TREE_URI, "");
            if (saved == null || saved.isEmpty()) {
                throw new IOException("尚未选择 Android 项目目录。");
            }
            loadProject(Uri.parse(saved));
            uri = documentUris.get(path);
        }

        if (uri == null) {
            throw new IOException("项目中找不到文件：" + path);
        }

        return uri;
    }

    private byte[] readBytes(Uri uri, int maxBytes) throws IOException {
        try (
            InputStream input = getContext()
                .getContentResolver()
                .openInputStream(uri)
        ) {
            if (input == null) {
                throw new IOException("系统无法打开文件输入流。");
            }

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;

            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new IOException(
                        "文件过大，超过 "
                            + (maxBytes / 1024 / 1024)
                            + " MB 限制。"
                    );
                }
                output.write(buffer, 0, read);
            }

            return output.toByteArray();
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(
            PREFS_NAME,
            Context.MODE_PRIVATE
        );
    }

    private String normalizeRelativePath(String value) {
        if (value == null) {
            return "";
        }

        String normalized = value
            .replace('\\', '/')
            .trim();

        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }

        if (
            normalized.contains("../")
                || normalized.equals("..")
        ) {
            return "";
        }

        return normalized;
    }

    private String guessTextMimeType(
        String path
    ) {
        String lower =
            path.toLowerCase(Locale.ROOT);

        if (lower.endsWith(".html")) {
            return "text/html";
        }
        if (lower.endsWith(".css")) {
            return "text/css";
        }
        if (
            lower.endsWith(".json")
                || lower.endsWith(".jsonc")
        ) {
            return "application/json";
        }
        if (lower.endsWith(".xml")) {
            return "application/xml";
        }
        if (lower.endsWith(".txt")) {
            return "text/plain";
        }

        // Avoid provider-added .txt for source-code file names.
        // File contents are still read and written as UTF-8 text.
        return "application/octet-stream";
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) return "image/png";
        if (
            lower.endsWith(".jpg")
                || lower.endsWith(".jpeg")
        ) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private String safeMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) {
            return error.getClass().getSimpleName();
        }
        return message;
    }
}
