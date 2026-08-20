package com.chengyang.codetutor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must be registered before BridgeActivity creates the Capacitor bridge.
        registerPlugin(AndroidProjectPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
