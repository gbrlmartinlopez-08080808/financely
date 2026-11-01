package app.frogity.reader;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page's handle on {@link WorkService}: show progress while Frogity reads in the background, then say when it is ready. */
@CapacitorPlugin(name = "Work")
public class WorkPlugin extends Plugin {
    private static final int READY = 7203;

    @PluginMethod
    public void show(PluginCall call) {
        Context ctx = getContext();
        WorkService.title = call.getString("title", "Frogity");
        WorkService.text = call.getString("text", "");
        WorkService.progress = call.getInt("progress", 0);
        WorkService.max = call.getInt("max", 100);
        WorkService.idle = Boolean.TRUE.equals(call.getBoolean("idle", false));
        NotificationManagerCompat.from(ctx).cancel(READY);
        FrogityWebView.keepWorking = true; // the page keeps running at full speed while this is shown (also just to stay reachable)
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, WorkService.class));
        } catch (Exception e) {
            /* Android only lets an app start this while it is on screen: if it can't, a normal notification will do */
        }
        call.resolve();
    }

    private void stop(Context ctx) {
        FrogityWebView.letRest();
        ctx.stopService(new Intent(ctx, WorkService.class));
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(WorkService.ID);
    }

    @PluginMethod
    public void done(PluginCall call) {
        Context ctx = getContext();
        stop(ctx);
        WorkService.channel(ctx);
        int icon = ctx.getResources().getIdentifier("ic_stat_frogity", "drawable", ctx.getPackageName());
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(
            ctx, 78, new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        try {
            NotificationManagerCompat.from(ctx).notify(READY, new NotificationCompat.Builder(ctx, WorkService.CHANNEL)
                .setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_notify_sync)
                .setContentTitle(call.getString("title", "Ready to read"))
                .setContentText(call.getString("text", ""))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build());
        } catch (SecurityException ignored) {
            /* notifications not allowed */
        }
        call.resolve();
    }

    /** Is Frogity allowed to keep working in the background (left out of the phone's battery saving)? */
    @PluginMethod
    public void battery(PluginCall call) {
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        r.put("free", pm == null || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(r);
    }

    /** Asks the phone (with its own dialog) to leave Frogity out of battery saving, so reading goes on with the app closed. */
    @PluginMethod
    public void askBattery(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Exception ignored) {
                /* nothing to open */
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        stop(getContext());
        call.resolve();
    }
}
