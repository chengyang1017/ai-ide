package com.chengyang.codetutor;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "GitHubAuth")
public class GitHubAuthPlugin extends Plugin {
    private static final String CLIENT_ID = "Iv23likla6INErohzq2q";
    private static final String PREFS_NAME = "code_tutor_github_auth";
    private static final String PREF_ACCESS = "access_ciphertext";
    private static final String PREF_ACCESS_IV = "access_iv";
    private static final String PREF_REFRESH = "refresh_ciphertext";
    private static final String PREF_REFRESH_IV = "refresh_iv";
    private static final String PREF_ACCESS_EXPIRES_AT = "access_expires_at";
    private static final String PREF_REFRESH_EXPIRES_AT = "refresh_expires_at";
    private static final String PREF_DEVICE = "pending_device_ciphertext";
    private static final String PREF_DEVICE_IV = "pending_device_iv";
    private static final String PREF_USER_CODE = "pending_user_code";
    private static final String PREF_VERIFICATION_URI = "pending_verification_uri";
    private static final String PREF_DEVICE_EXPIRES_AT = "pending_device_expires_at";
    private static final String PREF_DEVICE_INTERVAL = "pending_device_interval";
    private static final String KEYSTORE_ALIAS = "code_tutor_github_auth_v1";
    private static final String API_VERSION = "2026-03-10";
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int MAX_TEXT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ASSET_BYTES = 12 * 1024 * 1024;

    @PluginMethod
    public void beginDeviceFlow(PluginCall call) {
        try {
            Map<String, String> form = new LinkedHashMap<>();
            form.put("client_id", CLIENT_ID);
            JSONObject body = postForm(
                "https://github.com/login/device/code",
                form
            );

            String deviceCode = body.optString("device_code", "");
            String userCode = body.optString("user_code", "");
            if (deviceCode.isEmpty() || userCode.isEmpty()) {
                throw new IOException("GitHub 没有返回设备登录验证码。");
            }

            JSObject result = new JSObject();
            result.put("deviceCode", deviceCode);
            result.put("userCode", userCode);
            int expiresIn = body.optInt("expires_in", 900);
            int interval = Math.max(5, body.optInt("interval", 5));
            String verificationUri =
                body.optString(
                    "verification_uri",
                    "https://github.com/login/device"
                );

            result.put("verificationUri", verificationUri);
            result.put("expiresIn", expiresIn);
            result.put("interval", interval);

            savePendingDeviceFlow(
                deviceCode,
                userCode,
                verificationUri,
                expiresIn,
                interval
            );

            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "启动 GitHub 登录失败：" + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void pollDeviceFlow(PluginCall call) {
        String deviceCode = call.getString("deviceCode", "").trim();

        try {
            if (deviceCode.isEmpty()) {
                deviceCode =
                    decryptPreference(
                        PREF_DEVICE,
                        PREF_DEVICE_IV
                    );
            }
        } catch (Exception error) {
            call.reject(
                "读取 GitHub 待授权状态失败："
                    + safeMessage(error),
                error
            );
            return;
        }

        if (deviceCode.isEmpty()) {
            call.reject("GitHub device code 不能为空。");
            return;
        }

        try {
            Map<String, String> form = new LinkedHashMap<>();
            form.put("client_id", CLIENT_ID);
            form.put("device_code", deviceCode);
            form.put(
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code"
            );

            JSONObject body = postForm(
                "https://github.com/login/oauth/access_token",
                form
            );

            String accessToken = body.optString("access_token", "");
            if (!accessToken.isEmpty()) {
                saveTokenResponse(body);
                clearPendingDeviceFlow();
                JSObject result = new JSObject();
                result.put("status", "authorized");
                call.resolve(result);
                return;
            }

            String status =
                body.optString(
                    "error",
                    "authorization_pending"
                );

            if (
                "expired_token".equals(status)
                    || "access_denied".equals(status)
            ) {
                clearPendingDeviceFlow();
            }

            JSObject result = new JSObject();
            result.put(
                "status",
                status
            );
            result.put(
                "description",
                body.optString("error_description", "")
            );
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "检查 GitHub 登录状态失败：" + safeMessage(error),
                error
            );
        }
    }


    @PluginMethod
    public void getPendingDeviceFlow(
        PluginCall call
    ) {
        try {
            String deviceCode =
                decryptPreference(
                    PREF_DEVICE,
                    PREF_DEVICE_IV
                );
            long expiresAt =
                prefs().getLong(
                    PREF_DEVICE_EXPIRES_AT,
                    0L
                );
            long now =
                System.currentTimeMillis();

            if (
                deviceCode.isEmpty()
                    || expiresAt <= now
            ) {
                clearPendingDeviceFlow();
                JSObject result = new JSObject();
                result.put("active", false);
                call.resolve(result);
                return;
            }

            JSObject result = new JSObject();
            result.put("active", true);
            result.put("deviceCode", deviceCode);
            result.put(
                "userCode",
                prefs().getString(
                    PREF_USER_CODE,
                    ""
                )
            );
            result.put(
                "verificationUri",
                prefs().getString(
                    PREF_VERIFICATION_URI,
                    "https://github.com/login/device"
                )
            );
            result.put(
                "expiresIn",
                Math.max(
                    1L,
                    (expiresAt - now) / 1000L
                )
            );
            result.put(
                "interval",
                Math.max(
                    5,
                    prefs().getInt(
                        PREF_DEVICE_INTERVAL,
                        5
                    )
                )
            );
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "读取 GitHub 待授权状态失败："
                    + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void getLoginState(PluginCall call) {
        try {
            String token = validAccessToken();
            if (token.isEmpty()) {
                JSObject result = new JSObject();
                result.put("authenticated", false);
                call.resolve(result);
                return;
            }

            HttpResult response = apiRequest("/user", token, "application/vnd.github+json", MAX_TEXT_BYTES);
            if (response.status == 401) {
                clearStoredTokens();
                JSObject result = new JSObject();
                result.put("authenticated", false);
                call.resolve(result);
                return;
            }
            ensureSuccess(response, "读取 GitHub 账户失败");

            JSONObject user = new JSONObject(response.text());
            JSObject result = new JSObject();
            result.put("authenticated", true);
            result.put("login", user.optString("login", ""));
            result.put("name", user.optString("name", ""));
            result.put("avatarUrl", user.optString("avatar_url", ""));
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "读取 GitHub 登录状态失败：" + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void logout(PluginCall call) {
        try {
            clearStoredTokens();
            JSObject result = new JSObject();
            result.put("value", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "退出 GitHub 登录失败：" + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void apiGet(PluginCall call) {
        String path = normalizeApiPath(call.getString("path", ""));
        if (path.isEmpty()) {
            call.reject("GitHub API path 无效。");
            return;
        }

        try {
            String token = validAccessToken();
            HttpResult response = apiRequest(
                path,
                token,
                "application/vnd.github+json",
                MAX_TEXT_BYTES
            );
            JSObject result = new JSObject();
            result.put("status", response.status);
            result.put("body", response.text());
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "GitHub API 请求失败：" + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void readRepositoryFile(PluginCall call) {
        String owner = normalizeSegment(call.getString("owner", ""));
        String repo = normalizeSegment(call.getString("repo", ""));
        String ref = call.getString("ref", "").trim();
        String path = normalizeRepositoryPath(call.getString("path", ""));

        if (owner.isEmpty() || repo.isEmpty() || ref.isEmpty() || path.isEmpty()) {
            call.reject("GitHub 仓库文件参数不完整。");
            return;
        }

        try {
            String token = validAccessToken();
            String apiPath = repositoryContentsPath(owner, repo, path, ref);
            HttpResult response = apiRequest(
                apiPath,
                token,
                "application/vnd.github.raw+json",
                MAX_TEXT_BYTES
            );
            ensureSuccess(response, "读取 GitHub 文件失败");

            JSObject result = new JSObject();
            result.put("path", path);
            result.put("content", response.text());
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "读取 GitHub 文件失败：" + path + " · " + safeMessage(error),
                error
            );
        }
    }

    @PluginMethod
    public void readRepositoryAsset(PluginCall call) {
        String owner = normalizeSegment(call.getString("owner", ""));
        String repo = normalizeSegment(call.getString("repo", ""));
        String ref = call.getString("ref", "").trim();
        String path = normalizeRepositoryPath(call.getString("path", ""));

        if (owner.isEmpty() || repo.isEmpty() || ref.isEmpty() || path.isEmpty()) {
            call.reject("GitHub 仓库资源参数不完整。");
            return;
        }

        try {
            String token = validAccessToken();
            String apiPath = repositoryContentsPath(owner, repo, path, ref);
            HttpResult response = apiRequest(
                apiPath,
                token,
                "application/vnd.github.raw+json",
                MAX_ASSET_BYTES
            );
            ensureSuccess(response, "读取 GitHub 资源失败");

            String mimeType = response.contentType;
            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = guessMimeType(path);
            }

            JSObject result = new JSObject();
            result.put("path", path);
            result.put("mimeType", mimeType);
            result.put(
                "dataUrl",
                "data:" + mimeType + ";base64,"
                    + Base64.encodeToString(response.body, Base64.NO_WRAP)
            );
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "读取 GitHub 资源失败：" + path + " · " + safeMessage(error),
                error
            );
        }
    }

    private String validAccessToken() throws Exception {
        String accessToken = decryptPreference(PREF_ACCESS, PREF_ACCESS_IV);
        if (accessToken.isEmpty()) {
            return "";
        }

        long expiresAt = prefs().getLong(PREF_ACCESS_EXPIRES_AT, 0L);
        if (expiresAt <= 0L || System.currentTimeMillis() < expiresAt - 60_000L) {
            return accessToken;
        }

        String refreshToken = decryptPreference(PREF_REFRESH, PREF_REFRESH_IV);
        long refreshExpiresAt = prefs().getLong(PREF_REFRESH_EXPIRES_AT, 0L);
        if (
            refreshToken.isEmpty()
                || (refreshExpiresAt > 0L && System.currentTimeMillis() >= refreshExpiresAt)
        ) {
            clearStoredTokens();
            return "";
        }

        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", CLIENT_ID);
        form.put("grant_type", "refresh_token");
        form.put("refresh_token", refreshToken);
        JSONObject refreshed = postForm(
            "https://github.com/login/oauth/access_token",
            form
        );

        String nextAccess = refreshed.optString("access_token", "");
        if (nextAccess.isEmpty()) {
            clearStoredTokens();
            return "";
        }

        saveTokenResponse(refreshed);
        return nextAccess;
    }

    private void saveTokenResponse(JSONObject body) throws Exception {
        String accessToken = body.optString("access_token", "");
        if (accessToken.isEmpty()) {
            throw new IOException("GitHub 没有返回 access token。");
        }

        String refreshToken = body.optString("refresh_token", "");
        int expiresIn = body.optInt("expires_in", 0);
        int refreshExpiresIn = body.optInt("refresh_token_expires_in", 0);
        long now = System.currentTimeMillis();

        saveEncryptedPreference(PREF_ACCESS, PREF_ACCESS_IV, accessToken);
        if (!refreshToken.isEmpty()) {
            saveEncryptedPreference(PREF_REFRESH, PREF_REFRESH_IV, refreshToken);
        } else {
            prefs().edit().remove(PREF_REFRESH).remove(PREF_REFRESH_IV).apply();
        }

        prefs()
            .edit()
            .putLong(
                PREF_ACCESS_EXPIRES_AT,
                expiresIn > 0 ? now + expiresIn * 1000L : 0L
            )
            .putLong(
                PREF_REFRESH_EXPIRES_AT,
                refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000L : 0L
            )
            .apply();
    }

    private void savePendingDeviceFlow(
        String deviceCode,
        String userCode,
        String verificationUri,
        int expiresIn,
        int interval
    ) throws Exception {
        long expiresAt =
            System.currentTimeMillis()
                + Math.max(1, expiresIn)
                * 1000L;

        saveEncryptedPreference(
            PREF_DEVICE,
            PREF_DEVICE_IV,
            deviceCode
        );

        prefs()
            .edit()
            .putString(PREF_USER_CODE, userCode)
            .putString(
                PREF_VERIFICATION_URI,
                verificationUri
            )
            .putLong(
                PREF_DEVICE_EXPIRES_AT,
                expiresAt
            )
            .putInt(
                PREF_DEVICE_INTERVAL,
                Math.max(5, interval)
            )
            .apply();
    }

    private void clearPendingDeviceFlow()
        throws Exception {
        prefs()
            .edit()
            .remove(PREF_DEVICE)
            .remove(PREF_DEVICE_IV)
            .remove(PREF_USER_CODE)
            .remove(PREF_VERIFICATION_URI)
            .remove(PREF_DEVICE_EXPIRES_AT)
            .remove(PREF_DEVICE_INTERVAL)
            .apply();
    }

    private JSONObject postForm(
        String url,
        Map<String, String> form
    ) throws Exception {
        byte[] payload = encodeForm(form).getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setRequestProperty("User-Agent", "Code-Tutor-IDE");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(payload.length);

        try {
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
                output.flush();
            }
            HttpResult response = readResponse(connection, MAX_TEXT_BYTES);
            ensureSuccess(response, "GitHub OAuth 请求失败");
            return new JSONObject(response.text());
        } finally {
            connection.disconnect();
        }
    }

    private HttpResult apiRequest(
        String path,
        String token,
        String accept,
        int maxBytes
    ) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(
            "https://api.github.com" + normalizeApiPath(path)
        ).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", accept);
        connection.setRequestProperty("X-GitHub-Api-Version", API_VERSION);
        connection.setRequestProperty("User-Agent", "Code-Tutor-IDE");
        if (token != null && !token.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }

        try {
            return readResponse(connection, maxBytes);
        } finally {
            connection.disconnect();
        }
    }

    private HttpResult readResponse(
        HttpURLConnection connection,
        int maxBytes
    ) throws Exception {
        int status = connection.getResponseCode();
        InputStream input = status >= 400
            ? connection.getErrorStream()
            : connection.getInputStream();
        byte[] body = input == null ? new byte[0] : readBytes(input, maxBytes);
        return new HttpResult(status, body, connection.getContentType());
    }

    private byte[] readBytes(InputStream input, int maxBytes) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new IOException("GitHub 返回内容过大。");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private void ensureSuccess(HttpResult response, String message) throws IOException {
        if (response.status >= 200 && response.status < 300) {
            return;
        }
        String detail = response.text();
        if (detail.length() > 240) {
            detail = detail.substring(0, 240);
        }
        throw new IOException(message + " · HTTP " + response.status + (detail.isEmpty() ? "" : " · " + detail));
    }

    private String repositoryContentsPath(
        String owner,
        String repo,
        String path,
        String ref
    ) throws Exception {
        return "/repos/"
            + encode(owner)
            + "/"
            + encode(repo)
            + "/contents/"
            + encodePath(path)
            + "?ref="
            + encode(ref);
    }

    private String normalizeApiPath(String value) {
        String path = value == null ? "" : value.trim();
        if (!path.startsWith("/") || path.startsWith("//") || path.contains("\\")) {
            return "";
        }
        return path;
    }

    private String normalizeSegment(String value) {
        String result = value == null ? "" : value.trim();
        if (result.isEmpty() || result.contains("/") || result.contains("\\") || result.contains("..")) {
            return "";
        }
        return result;
    }

    private String normalizeRepositoryPath(String value) {
        String path = value == null ? "" : value.trim().replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.isEmpty() || path.contains("../") || path.equals("..")) {
            return "";
        }
        return path;
    }

    private String encodePath(String path) throws Exception {
        String[] parts = path.split("/");
        StringBuilder result = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) {
                continue;
            }
            if (result.length() > 0) {
                result.append('/');
            }
            result.append(encode(part));
        }
        return result.toString();
    }

    private String encodeForm(Map<String, String> form) throws Exception {
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, String> entry : form.entrySet()) {
            if (result.length() > 0) {
                result.append('&');
            }
            result.append(encode(entry.getKey()));
            result.append('=');
            result.append(encode(entry.getValue()));
        }
        return result.toString();
    }

    private String encode(String value) throws Exception {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.toString()).replace("+", "%20");
    }

    private void saveEncryptedPreference(
        String valueKey,
        String ivKey,
        String value
    ) throws Exception {
        SecretKey key = getOrCreateKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        prefs()
            .edit()
            .putString(valueKey, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(ivKey, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .apply();
    }

    private String decryptPreference(String valueKey, String ivKey) throws Exception {
        String ciphertext = prefs().getString(valueKey, "");
        String iv = prefs().getString(ivKey, "");
        if (ciphertext == null || ciphertext.isEmpty() || iv == null || iv.isEmpty()) {
            return "";
        }

        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
            clearStoredTokens();
            return "";
        }

        SecretKey key = (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
        );
        return new String(
            cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)),
            StandardCharsets.UTF_8
        );
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private void clearStoredTokens() throws Exception {
        prefs()
            .edit()
            .clear()
            .apply();

        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
            keyStore.deleteEntry(KEYSTORE_ALIAS);
        }
    }

    private android.content.SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? error.getClass().getSimpleName()
            : message;
    }

    private static final class HttpResult {
        final int status;
        final byte[] body;
        final String contentType;

        HttpResult(int status, byte[] body, String contentType) {
            this.status = status;
            this.body = body;
            this.contentType = contentType;
        }

        String text() {
            return new String(body, StandardCharsets.UTF_8);
        }
    }
}
