package app.frogity.reader;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the page hand its streak numbers to the home-screen widget. */
@CapacitorPlugin(name = "Widget")
public class WidgetPlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor e = ctx.getSharedPreferences(StreakWidget.PREFS, Context.MODE_PRIVATE).edit();
        e.putString("day", call.getString("day", ""));
        e.putInt("streak", call.getInt("streak", 0));
        e.putInt("today", call.getInt("today", 0));
        e.putInt("goal", call.getInt("goal", 15));
        e.putString("week", call.getString("week", "·······"));
        e.apply();
        StreakWidget.refresh(ctx);
        call.resolve();
    }
}
