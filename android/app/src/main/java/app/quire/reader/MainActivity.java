package app.quire.reader;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        IncomingPlugin.setLaunchIntent(getIntent());
        registerPlugin(IncomingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
