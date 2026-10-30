package app.frogity.reader;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** "Continue reading": the cover, how far you are, and a ▶ that opens the book where you left off. */
public class BookWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        WidgetData d = WidgetData.load(ctx);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_book);
        d.bindBook(ctx, v, R.id.w_cover, R.id.w_book_title, 0);
        v.setTextViewText(R.id.w_book_sub, d.docId.isEmpty() ? "nothing on the shelf yet" : "continue reading");
        v.setTextViewText(R.id.w_bar, WidgetData.colour(d.docId.isEmpty() ? "tap to add a book" : barPct(d.bookPct)));
        String action = d.docId.isEmpty() ? "add" : "continue";
        v.setOnClickPendingIntent(R.id.widget_root, WidgetData.tap(ctx, action, d.docId));
        v.setOnClickPendingIntent(R.id.btn_continue, WidgetData.tap(ctx, action, d.docId));
        return v;
    }

    private static String barPct(int pct) {
        int filled = Math.round(10 * pct / 100f);
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < 10; i++) b.append(i < filled ? '@' : '·');
        return b.append("] ").append(pct).append('%').toString();
    }
}
