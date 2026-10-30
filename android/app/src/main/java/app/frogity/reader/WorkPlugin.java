package app.frogity.reader;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** A progress notification for the reading Frogity does in the background, and a "ready" note when it is finished. */
@CapacitorPlugin(name = "Work")
public class WorkPlugin extends Plugin {
    private static final String CHANNEL = "frogity_work";
    private static final int ONGOING = 7202;
    private static final int READY = 7203;

    private void channel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "Reading in the background", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Progress while Frogity reads scans and prepares your books");
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
    }

    private NotificationCompat.Builder base(Context ctx, String title, String text) {
        channel(ctx);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 77, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int icon = ctx.getResources().getIdentifier("ic_stat_frogity", "drawable", ctx.getPackageName());
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true);
    }

    private void post(int id, android.app.Notification n) {
        try {
            NotificationManagerCompat.from(getContext()).notify(id, n);
        } catch (SecurityException ignored) {
            /* notifications not allowed: nothing to show */
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        Context ctx = getContext();
        NotificationCompat.Builder b = base(ctx, call.getString("title", "Frogity"), call.getString("text", ""))
            .setOngoing(true)
            .setProgress(call.getInt("max", 100), call.getInt("progress", 0), false);
        NotificationManagerCompat.from(ctx).cancel(READY);
        post(ONGOING, b.build());
        call.resolve();
    }

    @PluginMethod
    public void done(PluginCall call) {
        Context ctx = getContext();
        NotificationManagerCompat.from(ctx).cancel(ONGOING);
        NotificationCompat.Builder b = base(ctx, call.getString("title", "Ready to read"), call.getString("text", "")).setAutoCancel(true);
        post(READY, b.build());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(ONGOING);
        call.resolve();
    }
}
