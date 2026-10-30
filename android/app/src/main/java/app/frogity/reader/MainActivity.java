package app.frogity.reader;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        IncomingPlugin.setLaunchIntent(getIntent());
        registerPlugin(IncomingPlugin.class);
        registerPlugin(ListenPlugin.class);
        registerPlugin(WidgetPlugin.class);
        registerPlugin(WorkPlugin.class);
        super.onCreate(savedInstanceState);
        WidgetPlugin.handle(getIntent());
        // Let the page choose its own layout width (the app scales its interface to fit).
        WebSettings s = getBridge().getWebView().getSettings();
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        WidgetPlugin.handle(intent);
    }
}
