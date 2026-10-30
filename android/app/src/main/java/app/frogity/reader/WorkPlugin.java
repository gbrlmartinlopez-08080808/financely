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
        NotificationManagerCompat.from(ctx).cancel(READY);
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, WorkService.class));
        } catch (Exception e) {
            /* Android only lets an app start this while it is on screen: if it can't, a normal notification will do */
        }
        call.resolve();
    }

    private void stop(Context ctx) {
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

    @PluginMethod
    public void clear(PluginCall call) {
        stop(getContext());
        call.resolve();
    }
}
