package app.quire.reader;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page's handle on {@link ListenService}: start/update/stop the "now reading" player and hear its buttons. */
@CapacitorPlugin(name = "Listen")
public class ListenPlugin extends Plugin {
    @Override
    public void load() {
        ListenService.listener = action -> {
            JSObject o = new JSObject();
            o.put("action", action);
            notifyListeners("action", o);
        };
    }

    private void apply(PluginCall call) {
        ListenService.title = call.getString("title", ListenService.title);
        ListenService.subtitle = call.getString("subtitle", ListenService.subtitle);
        ListenService.playing = Boolean.TRUE.equals(call.getBoolean("playing", ListenService.playing));
        String cover = call.getString("cover");
        if (cover != null && !cover.isEmpty()) {
            try {
                byte[] raw = Base64.decode(cover, Base64.DEFAULT);
                Bitmap b = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                if (b != null) ListenService.cover = b;
            } catch (Exception ignored) {
                /* no artwork */
            }
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        apply(call);
        Context c = getContext();
        ContextCompat.startForegroundService(c, new Intent(c, ListenService.class).setAction(ListenService.A_UPDATE));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        apply(call);
        Context c = getContext();
        c.startService(new Intent(c, ListenService.class).setAction(ListenService.A_UPDATE));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        ListenService.cover = null;
        c.startService(new Intent(c, ListenService.class).setAction(ListenService.A_STOP));
        call.resolve();
    }
}
