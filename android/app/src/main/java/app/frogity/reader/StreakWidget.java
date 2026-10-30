package app.frogity.reader;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Home-screen widget: the streak, the last seven days as ASCII glyphs, and today's progress. */
public class StreakWidget extends AppWidgetProvider {
    static final String PREFS = "frogity_widget";
    private static final int YELLOW = Color.rgb(0xF2, 0xC9, 0x4C);
    private static final int ICE = Color.rgb(0x5B, 0x8D, 0xFF);

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    /** Called by {@link WidgetPlugin} whenever the page has new numbers. */
    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, StreakWidget.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    private static int dayDiff(String from, String to) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            return (int) Math.round((f.parse(to).getTime() - f.parse(from).getTime()) / 86400000.0);
        } catch (Exception e) {
            return 0;
        }
    }

    private static SpannableString colour(String s) {
        SpannableString sp = new SpannableString(s);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '@') sp.setSpan(new ForegroundColorSpan(YELLOW), i, i + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            else if (c == '~') sp.setSpan(new ForegroundColorSpan(ICE), i, i + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            else if (c == '%' || c == '*') sp.setSpan(new ForegroundColorSpan(Color.rgb(0xD6, 0xD5, 0xD0)), i, i + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return sp;
    }

    static RemoteViews build(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String saved = p.getString("day", today);
        int streak = p.getInt("streak", 0);
        int goal = Math.max(1, p.getInt("goal", 15));
        int mins = p.getInt("today", 0);
        String week = p.getString("week", "·······");
        int gap = Math.max(0, dayDiff(saved, today));
        if (gap > 0) {
            // the page hasn't run since midnight: today is a fresh day, and the week slides along
            mins = 0;
            if (gap > 1) streak = 0; // a whole day went by unread (a freeze would have been applied by the app)
            StringBuilder w = new StringBuilder(week);
            for (int i = 0; i < Math.min(gap, 7); i++) {
                w.deleteCharAt(0);
                w.append('·');
            }
            week = w.toString();
        }
        if (week.length() > 7) week = week.substring(week.length() - 7);

        int slots = 10;
        int filled = Math.min(slots, (int) Math.round(slots * Math.min(1.0, mins / (double) goal)));
        StringBuilder bar = new StringBuilder("[");
        for (int i = 0; i < slots; i++) bar.append(i < filled ? '@' : '·');
        bar.append("] ").append(mins).append('/').append(goal).append(" min");

        StringBuilder spaced = new StringBuilder();
        for (int i = 0; i < week.length(); i++) {
            if (i > 0) spaced.append(' ');
            spaced.append(week.charAt(i));
        }

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_streak);
        v.setTextViewText(R.id.widget_title, colour("@ " + streak + (streak == 1 ? " day streak" : " day streak")));
        v.setTextViewText(R.id.widget_week, colour(spaced.toString()));
        v.setTextViewText(R.id.widget_bar, colour(bar.toString()));
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
}
