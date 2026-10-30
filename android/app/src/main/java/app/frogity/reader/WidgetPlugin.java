package app.frogity.reader;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/** Lets the page hand its numbers to the home-screen widgets, and hears what you tapped on them. */
@CapacitorPlugin(name = "Widget")
public class WidgetPlugin extends Plugin {
    private static WidgetPlugin live;
    private static String pendingAction;
    private static String pendingDoc;

    @Override
    public void load() {
        live = this;
    }

    /** The activity calls this with every launch or new intent; a widget tap carries an action. */
    static void handle(Intent intent) {
        if (intent == null) return;
        String a = intent.getStringExtra(WidgetData.EXTRA_ACTION);
        if (a == null || a.isEmpty()) return;
        String doc = intent.getStringExtra(WidgetData.EXTRA_DOC);
        intent.removeExtra(WidgetData.EXTRA_ACTION);
        if (live != null) {
            JSObject o = new JSObject();
            o.put("action", a);
            o.put("doc", doc == null ? "" : doc);
            live.notifyListeners("action", o, true);
        } else {
            pendingAction = a;
            pendingDoc = doc;
        }
    }

    @PluginMethod
    public void getAction(PluginCall call) {
        JSObject o = new JSObject();
        o.put("action", pendingAction == null ? "" : pendingAction);
        o.put("doc", pendingDoc == null ? "" : pendingDoc);
        pendingAction = null;
        pendingDoc = null;
        call.resolve(o);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor e = ctx.getSharedPreferences(WidgetData.PREFS, Context.MODE_PRIVATE).edit();
        e.putString("day", call.getString("day", ""));
        e.putInt("streak", call.getInt("streak", 0));
        e.putInt("today", call.getInt("today", 0));
        e.putInt("goal", call.getInt("goal", 15));
        e.putString("week", call.getString("week", "·······"));
        e.putString("heat", call.getString("heat", ""));
        e.putString("docId", call.getString("docId", ""));
        e.putString("bookTitle", call.getString("bookTitle", ""));
        e.putInt("bookPct", call.getInt("bookPct", 0));
        e.apply();
        String cover = call.getString("cover");
        File f = new File(ctx.getFilesDir(), "widget_cover.jpg");
        if (cover != null && !cover.isEmpty()) {
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(Base64.decode(cover, Base64.DEFAULT));
            } catch (Exception ignored) {
                /* keep the old picture */
            }
        } else if (call.getString("docId", "").isEmpty() && f.exists()) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        StreakWidget.refresh(ctx);
        call.resolve();
    }
}
