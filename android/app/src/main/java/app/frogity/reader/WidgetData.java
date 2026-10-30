package app.frogity.reader;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.widget.RemoteViews;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** What the home-screen widgets show (numbers the page last handed over) and what tapping them does. */
final class WidgetData {
    static final String PREFS = "frogity_widget";
    static final String EXTRA_ACTION = "frogity_action";
    static final String EXTRA_DOC = "frogity_doc";
    private static final int YELLOW = Color.rgb(0xF2, 0xC9, 0x4C);
    private static final int ICE = Color.rgb(0x5B, 0x8D, 0xFF);
    private static final int PAPER = Color.rgb(0xD6, 0xD5, 0xD0);

    int streak, today, goal;
    String week, heat, docId, bookTitle;
    int bookPct;
    Bitmap cover;

    static WidgetData load(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        WidgetData d = new WidgetData();
        String now = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String saved = p.getString("day", now);
        d.streak = p.getInt("streak", 0);
        d.goal = Math.max(1, p.getInt("goal", 15));
        d.today = p.getInt("today", 0);
        d.week = p.getString("week", "·······");
        d.heat = p.getString("heat", "");
        d.docId = p.getString("docId", "");
        d.bookTitle = p.getString("bookTitle", "");
        d.bookPct = p.getInt("bookPct", 0);
        int gap = Math.max(0, dayDiff(saved, now));
        if (gap > 0) {
            // the page hasn't run since midnight: today is a fresh day and the rows slide along
            d.today = 0;
            if (gap > 1) d.streak = 0;
            d.week = slide(d.week, gap);
            d.heat = slide(d.heat, gap);
        }
        File f = new File(ctx.getFilesDir(), "widget_cover.jpg");
        if (f.exists()) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = 1;
            d.cover = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        }
        return d;
    }

    private static String slide(String s, int gap) {
        if (s == null || s.isEmpty()) return s;
        StringBuilder w = new StringBuilder(s);
        for (int i = 0; i < Math.min(gap, s.length()); i++) {
            w.deleteCharAt(0);
            w.append('·');
        }
        return w.toString();
    }

    private static int dayDiff(String from, String to) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            return (int) Math.round((f.parse(to).getTime() - f.parse(from).getTime()) / 86400000.0);
        } catch (Exception e) {
            return 0;
        }
    }

    static SpannableString colour(String s) {
        SpannableString sp = new SpannableString(s);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            int col = c == '@' ? YELLOW : c == '~' ? ICE : (c == '%' || c == '*') ? PAPER : 0;
            if (col != 0) sp.setSpan(new ForegroundColorSpan(col), i, i + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return sp;
    }

    String bar(int slots, boolean withText) {
        int filled = Math.min(slots, (int) Math.round(slots * Math.min(1.0, today / (double) goal)));
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < slots; i++) b.append(i < filled ? '@' : '·');
        b.append(']');
        if (withText) b.append(' ').append(today).append('/').append(goal).append(" min");
        return b.toString();
    }

    String spacedWeek() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < week.length(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(week.charAt(i));
        }
        return sb.toString();
    }

    /** Five weeks as rows of seven, oldest first. */
    String heatRows() {
        String h = heat == null ? "" : heat;
        StringBuilder sb = new StringBuilder();
        for (int r = 0; r * 7 < h.length(); r++) {
            if (r > 0) sb.append('\n');
            String row = h.substring(r * 7, Math.min(h.length(), r * 7 + 7));
            for (int i = 0; i < row.length(); i++) {
                if (i > 0) sb.append(' ');
                sb.append(row.charAt(i));
            }
        }
        return sb.length() == 0 ? spacedWeek() : sb.toString();
    }

    /** A tap that opens the app and tells the page what to do (open the streak, add, scan, continue a book). */
    static PendingIntent tap(Context ctx, String action, String docId) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .setData(Uri.parse("frogity://widget/" + action + (docId == null || docId.isEmpty() ? "" : "/" + docId)))
            .putExtra(EXTRA_ACTION, action)
            .putExtra(EXTRA_DOC, docId == null ? "" : docId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, (action + docId).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    void bindBook(Context ctx, RemoteViews v, int coverId, int titleId, int subId) {
        if (coverId != 0) {
            if (cover != null) v.setImageViewBitmap(coverId, cover);
            else v.setImageViewResource(coverId, R.drawable.widget_btn);
        }
        if (titleId != 0) v.setTextViewText(titleId, bookTitle == null || bookTitle.isEmpty() ? "Pick up where you left off" : bookTitle);
        if (subId != 0) v.setTextViewText(subId, bookTitle == null || bookTitle.isEmpty() ? "open Frogity" : bookPct + "% read");
    }
}
