package app.frogity.reader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Keeps Frogity running while it reads scans in the background: with the screen off, in another app, or when you
 * leave the book. It shows the progress as a notification and holds the CPU awake only while there is work.
 */
public class WorkService extends Service {
    static final String CHANNEL = "frogity_work";
    static final int ID = 7202;
    static volatile String title = "Frogity";
    static volatile String text = "";
    static volatile int progress = 0;
    static volatile int max = 100;
    static volatile boolean running = false;
    /** only keeping the phone reachable for a connected computer: no progress bar and no wake lock */
    static volatile boolean idle = false;

    private PowerManager.WakeLock wake;

    static void channel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "Reading in the background", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Progress while Frogity reads scans and prepares your books");
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
    }

    static Notification build(Context ctx) {
        channel(ctx);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 77, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int icon = ctx.getResources().getIdentifier("ic_stat_frogity", "drawable", ctx.getPackageName());
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(idle ? 0 : max, idle ? 0 : progress, false)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = build(this);
        if (!running) {
            running = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
        } else {
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID, n);
        }
        // the CPU is held awake only while there is real work (never when just staying reachable)
        if (!idle && (wake == null || !wake.isHeld())) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "frogity:work");
            wake.acquire(4 * 60 * 60 * 1000L); // never longer than four hours, whatever happens
        } else if (idle && wake != null && wake.isHeld()) wake.release();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
