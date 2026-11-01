package app.frogity.reader;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Switches the app's launcher icon between the classic one and the gradient one (two activity aliases; one is enabled). */
@CapacitorPlugin(name = "AppIcon")
public class IconPlugin extends Plugin {
    private ComponentName alias(String n) {
        return new ComponentName(getContext(), "app.frogity.reader." + n);
    }

    private boolean gradientOn() {
        int s = getContext().getPackageManager().getComponentEnabledSetting(alias("IconGradient"));
        return s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject o = new JSObject();
        o.put("icon", gradientOn() ? "gradient" : "classic");
        call.resolve(o);
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean g = "gradient".equals(call.getString("icon", "classic"));
        PackageManager pm = getContext().getPackageManager();
        // the new one is switched on first, so the app is never without a launcher entry
        pm.setComponentEnabledSetting(alias(g ? "IconGradient" : "IconClassic"), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        pm.setComponentEnabledSetting(alias(g ? "IconClassic" : "IconGradient"), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        JSObject o = new JSObject();
        o.put("icon", g ? "gradient" : "classic");
        call.resolve(o);
    }
}
