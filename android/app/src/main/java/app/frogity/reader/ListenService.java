package app.frogity.reader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;

/**
 * Keeps "listening" alive: a media-playback foreground service with a lock-screen / notification player.
 * The reading itself happens in the page (system voice or studio voice); this service makes Android treat it as
 * a track — it keeps playing with the screen off, shows play/pause/skip, and pauses for calls.
 */
public class ListenService extends Service {
    public interface Listener {
        void onAction(String action);
    }

    public static final String CHANNEL = "frogity_listen";
    public static final int NOTIF_ID = 4711;
    public static final String A_UPDATE = "app.frogity.reader.listen.UPDATE";
    public static final String A_STOP = "app.frogity.reader.listen.STOP";
    public static final String A_TOGGLE = "app.frogity.reader.listen.TOGGLE";
    public static final String A_NEXT = "app.frogity.reader.listen.NEXT";
    public static final String A_PREV = "app.frogity.reader.listen.PREV";

    static Listener listener;
    static volatile String title = "Frogity";
    static volatile String subtitle = "";
    static volatile boolean playing = false;
    static volatile Bitmap cover = null;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wake;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean foreground = false;

    @Override
    public void onCreate() {
        super.onCreate();
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "frogity:listen");
        wake.setReferenceCounted(false);
        session = new MediaSessionCompat(this, "Frogity");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { fire("play"); }
            @Override public void onPause() { fire("pause"); }
            @Override public void onSkipToNext() { fire("next"); }
            @Override public void onSkipToPrevious() { fire("prev"); }
            @Override public void onStop() { fire("stop"); }
        });
        session.setActive(true);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Listening", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows what Frogity is reading aloud, with play and pause");
            ch.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    private static void fire(String a) {
        Listener l = listener;
        if (l != null) l.onAction(a);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? A_UPDATE : intent.getAction();
        if (A_STOP.equals(a)) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (A_TOGGLE.equals(a)) fire("toggle");
        else if (A_NEXT.equals(a)) fire("next");
        else if (A_PREV.equals(a)) fire("prev");
        refresh();
        return START_NOT_STICKY;
    }

    private PendingIntent act(String action, int code) {
        Intent i = new Intent(this, ListenService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void refresh() {
        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Frogity");
        if (cover != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cover);
        session.setMetadata(md.build());
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_STOP;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());

        if (playing) {
            if (!wake.isHeld()) wake.acquire(6 * 60 * 60 * 1000L);
            requestFocus();
        } else {
            if (wake.isHeld()) wake.release();
            abandonFocus();
        }

        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getResources().getIdentifier("ic_stat_frogity", "drawable", getPackageName()))
            .setContentTitle(title)
            .setContentText(subtitle)
            .setLargeIcon(cover)
            .setContentIntent(content)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Back", act(A_PREV, 1))
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Play", act(A_TOGGLE, 2))
            .addAction(android.R.drawable.ic_media_next, "Forward", act(A_NEXT, 3))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = b.build();

        if (playing) {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIF_ID, n);
            foreground = true;
        } else {
            if (foreground) {
                // paused: the notification stays (so you can resume) but can be swiped away
                if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH);
                else stopForeground(false);
                foreground = false;
            }
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, n);
        }
    }

    private void requestFocus() {
        if (focus != null) return;
        AudioManager.OnAudioFocusChangeListener l = change -> {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) fire("pause");
        };
        if (Build.VERSION.SDK_INT >= 26) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener(l)
                .build();
            audio.requestAudioFocus(focus);
        }
    }

    private void abandonFocus() {
        if (focus != null && Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(focus);
        focus = null;
    }

    private void shutdown() {
        playing = false;
        if (wake.isHeld()) wake.release();
        abandonFocus();
        stopForeground(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIF_ID);
        foreground = false;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        abandonFocus();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
