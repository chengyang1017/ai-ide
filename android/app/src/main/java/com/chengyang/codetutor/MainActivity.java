package com.chengyang.codetutor;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {
    private static final Pattern GITHUB_URL_PATTERN =
        Pattern.compile(
            "https?://(?:www\\.)?github\\.com/[^\\s]+",
            Pattern.CASE_INSENSITIVE
        );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must be registered before BridgeActivity creates the Capacitor bridge.
        registerPlugin(AndroidProjectPlugin.class);
        registerPlugin(GitHubAuthPlugin.class);
        captureGitHubIntent(getIntent(), false);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureGitHubIntent(intent, true);
    }

    private void captureGitHubIntent(
        Intent intent,
        boolean notifyWebView
    ) {
        String url = extractGitHubUrl(intent);
        if (url.isEmpty()) {
            return;
        }

        AndroidProjectPlugin.setPendingGitHubUrl(url);

        if (!notifyWebView || bridge == null) {
            return;
        }

        try {
            JSONObject data = new JSONObject();
            data.put("url", url);
            bridge.triggerWindowJSEvent(
                "ai-ide-github-url",
                data.toString()
            );
        } catch (JSONException ignored) {
            // The pending native value is still available for the JS side.
        }
    }

    private String extractGitHubUrl(Intent intent) {
        if (intent == null) {
            return "";
        }

        String candidate = "";
        String action = intent.getAction();

        if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            candidate =
                data == null
                    ? ""
                    : data.toString();
        } else if (Intent.ACTION_SEND.equals(action)) {
            CharSequence shared =
                intent.getCharSequenceExtra(
                    Intent.EXTRA_TEXT
                );
            candidate =
                shared == null
                    ? ""
                    : shared.toString();
        }

        Matcher matcher =
            GITHUB_URL_PATTERN.matcher(candidate);

        if (!matcher.find()) {
            return "";
        }

        return stripTrailingPunctuation(
            matcher.group()
        );
    }

    private String stripTrailingPunctuation(
        String value
    ) {
        String result = value;

        while (
            result.endsWith(".")
                || result.endsWith(",")
                || result.endsWith(")")
                || result.endsWith("]")
                || result.endsWith("}")
        ) {
            result =
                result.substring(
                    0,
                    result.length() - 1
                );
        }

        return result;
    }
}
