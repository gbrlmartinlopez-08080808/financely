package app.frogity.reader;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.widget.RemoteViews;

import java.util.HashMap;
import java.util.Map;

/**
 * Home-screen streak widget in three sizes that follow the size you drag it to: a small counter, a wide one with the
 * week and today's bar, and a tall one with a five-week map, the book you're on and quick buttons.
 * Every part is tappable: the streak opens the stats, ▶ continues the book, + adds, ▣ scans.
 */
public class StreakWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, mgr, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        mgr.updateAppWidget(id, build(ctx, mgr, id));
    }

    /** Called by {@link WidgetPlugin} whenever the page has new numbers. */
    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, StreakWidget.class))) mgr.updateAppWidget(id, build(ctx, mgr, id));
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, BookWidget.class))) mgr.updateAppWidget(id, BookWidget.build(ctx));
    }

    static RemoteViews build(Context ctx, AppWidgetManager mgr, int id) {
        WidgetData d = WidgetData.load(ctx);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: hand over all three and the launcher picks the one that fits the current size
            Map<SizeF, RemoteViews> m = new HashMap<>();
            m.put(new SizeF(110f, 110f), small(ctx, d));
            m.put(new SizeF(230f, 110f), wide(ctx, d));
            m.put(new SizeF(230f, 250f), large(ctx, d));
            return new RemoteViews(m);
        }
        Bundle o = mgr.getAppWidgetOptions(id);
        int w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
        int h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
        if (w < 200) return small(ctx, d);
        if (h >= 220) return large(ctx, d);
        return wide(ctx, d);
    }

    private static RemoteViews small(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_small);
        v.setTextViewText(R.id.w_num, String.valueOf(d.streak));
        v.setTextViewText(R.id.w_label, d.streak == 1 ? "day streak" : "day streak");
        v.setTextViewText(R.id.w_bar, WidgetData.colour(d.bar(8, false)));
        v.setOnClickPendingIntent(R.id.widget_root, WidgetData.tap(ctx, "stats", ""));
        return v;
    }

    private static RemoteViews wide(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_streak);
        v.setTextViewText(R.id.widget_title, WidgetData.colour("@ " + d.streak + " day streak"));
        v.setTextViewText(R.id.widget_week, WidgetData.colour(d.spacedWeek()));
        v.setTextViewText(R.id.widget_bar, WidgetData.colour(d.bar(10, true)));
        v.setOnClickPendingIntent(R.id.widget_root, WidgetData.tap(ctx, "stats", ""));
        v.setOnClickPendingIntent(R.id.btn_continue, WidgetData.tap(ctx, d.docId.isEmpty() ? "add" : "continue", d.docId));
        v.setOnClickPendingIntent(R.id.btn_add, WidgetData.tap(ctx, "add", ""));
        v.setOnClickPendingIntent(R.id.btn_scan, WidgetData.tap(ctx, "scan", ""));
        return v;
    }

    private static RemoteViews large(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_large);
        v.setTextViewText(R.id.widget_title, WidgetData.colour("@ " + d.streak + " day streak"));
        v.setTextViewText(R.id.w_goal, d.today + "/" + d.goal + " min");
        v.setTextViewText(R.id.w_heat, WidgetData.colour(d.heatRows()));
        v.setTextViewText(R.id.widget_bar, WidgetData.colour(d.bar(16, false)));
        d.bindBook(ctx, v, R.id.w_cover, R.id.w_book_title, R.id.w_book_sub);
        v.setOnClickPendingIntent(R.id.w_main, WidgetData.tap(ctx, "stats", ""));
        v.setOnClickPendingIntent(R.id.w_heat, WidgetData.tap(ctx, "stats", ""));
        v.setOnClickPendingIntent(R.id.w_book, WidgetData.tap(ctx, d.docId.isEmpty() ? "add" : "continue", d.docId));
        v.setOnClickPendingIntent(R.id.btn_continue, WidgetData.tap(ctx, d.docId.isEmpty() ? "add" : "continue", d.docId));
        v.setOnClickPendingIntent(R.id.btn_add, WidgetData.tap(ctx, "add", ""));
        v.setOnClickPendingIntent(R.id.btn_scan, WidgetData.tap(ctx, "scan", ""));
        v.setOnClickPendingIntent(R.id.btn_stats, WidgetData.tap(ctx, "stats", ""));
        return v;
    }
}
