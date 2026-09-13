package com.swir.xadkiller;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.net.InetAddress;
import java.text.DateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class SystemConsoleActivity extends Activity {
    private LinearLayout logBox;
    private TextView infoText, privateDnsText, networkText, smartText;
    private boolean errorsOnly = false;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        refresh();
    }

    @Override protected void onResume() { super.onResume(); refresh(); }

    private void buildUi() {
        int bg=getColor(R.color.swir_bg), surface=getColor(R.color.swir_surface), surface2=getColor(R.color.swir_surface_2), blue=getColor(R.color.swir_blue), text=getColor(R.color.swir_text), muted=getColor(R.color.swir_muted), red=getColor(R.color.swir_red);
        ScrollView scroll=new ScrollView(this); scroll.setBackgroundColor(bg); scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(18),dp(18),dp(18),dp(30)); scroll.addView(root,new ScrollView.LayoutParams(-1,-2));

        TextView title=tv("SYSTEM CONSOLE",26,text,true); title.setLetterSpacing(.08f); root.addView(title);
        root.addView(tv("xADKiller 1.5.0 • DNS + Smart Engine + Adaptive AI • diagnostics",12,blue,true));
        root.addView(tv(I18n.languageStatus(this),10,muted,false));
        addSpace(root,12);

        LinearLayout health=card(surface,18); root.addView(health,lpMatchWrap());
        health.addView(tv("STAN SYSTEMU",15,text,true));
        privateDnsText=tv("Prywatny DNS: sprawdzanie…",13,muted,false); health.addView(privateDnsText);
        networkText=tv("Sieć: sprawdzanie…",13,muted,false); health.addView(networkText);
        smartText=tv("Smart Engine: sprawdzanie…",13,muted,false); health.addView(smartText);
        addSpace(health,8);
        LinearLayout healthBtns=new LinearLayout(this); healthBtns.setOrientation(LinearLayout.HORIZONTAL); health.addView(healthBtns,lpMatchWrap());
        Button dnsSettings=button("PRYWATNY DNS",surface2,text), testNet=button("TEST SIECI",surface2,text);
        LinearLayout.LayoutParams hb1=new LinearLayout.LayoutParams(0,dp(46),1); hb1.setMarginEnd(dp(5)); LinearLayout.LayoutParams hb2=new LinearLayout.LayoutParams(0,dp(46),1); hb2.setMarginStart(dp(5)); healthBtns.addView(dnsSettings,hb1); healthBtns.addView(testNet,hb2);
        dnsSettings.setOnClickListener(v->{try{startActivity(PrivateDnsHelper.settingsIntent());}catch(Exception e){SystemLogStore.error(this,"UI","Nie udało się otworzyć ustawień Prywatnego DNS",e);}});
        testNet.setOnClickListener(v->runNetworkTest());
        addSpace(root,12);

        LinearLayout controls=card(surface,18); root.addView(controls,lpMatchWrap()); controls.addView(tv("LOGOWANIE",15,text,true));
        Switch verbose=new Switch(this); verbose.setText(I18n.t(this,"Pełny log DNS (również dozwolone zapytania)")); verbose.setTextColor(text); verbose.setTextSize(13); verbose.setChecked(getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE).getBoolean(SystemLogStore.PREF_VERBOSE_DNS,false));
        verbose.setOnCheckedChangeListener((b,on)->{getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE).edit().putBoolean(SystemLogStore.PREF_VERBOSE_DNS,on).apply();SystemLogStore.info(this,"CONSOLE","Pełny log DNS: "+(on?"WŁĄCZONY":"WYŁĄCZONY"));refresh();}); controls.addView(verbose,lpMatchWrap());
        controls.addView(tv("Smart Engine zapisuje tutaj AD_DETECTED, AUTO-SKIP, MUTE, RESTORE i błędy. Log pozostaje lokalnie na telefonie.",11,muted,false));
        addSpace(controls,8);
        LinearLayout row1=new LinearLayout(this); row1.setOrientation(LinearLayout.HORIZONTAL); controls.addView(row1,lpMatchWrap());
        Button all=button("WSZYSTKO",blue,Color.BLACK), errors=button("TYLKO BŁĘDY",surface2,text);
        LinearLayout.LayoutParams a1=new LinearLayout.LayoutParams(0,dp(46),1); a1.setMarginEnd(dp(5)); LinearLayout.LayoutParams a2=new LinearLayout.LayoutParams(0,dp(46),1); a2.setMarginStart(dp(5)); row1.addView(all,a1); row1.addView(errors,a2);
        all.setOnClickListener(v->{errorsOnly=false;refresh();}); errors.setOnClickListener(v->{errorsOnly=true;refresh();});
        addSpace(controls,6);
        LinearLayout row2=new LinearLayout(this); row2.setOrientation(LinearLayout.HORIZONTAL); controls.addView(row2,lpMatchWrap());
        Button refreshBtn=button("ODŚWIEŻ",surface2,text), copy=button("KOPIUJ RAPORT",surface2,text), clear=button("WYCZYŚĆ",red,Color.WHITE);
        LinearLayout.LayoutParams c1=new LinearLayout.LayoutParams(0,dp(46),1); c1.setMarginEnd(dp(4)); LinearLayout.LayoutParams c2=new LinearLayout.LayoutParams(0,dp(46),1); c2.setMargins(dp(4),0,dp(4),0); LinearLayout.LayoutParams c3=new LinearLayout.LayoutParams(0,dp(46),1); c3.setMarginStart(dp(4)); row2.addView(refreshBtn,c1); row2.addView(copy,c2); row2.addView(clear,c3);
        refreshBtn.setOnClickListener(v->refresh()); copy.setOnClickListener(v->copyReport()); clear.setOnClickListener(v->new AlertDialog.Builder(this).setTitle(I18n.t(this,"Wyczyścić SYSTEM CONSOLE?")).setMessage(I18n.t(this,"Usunie lokalny log diagnostyczny, ale nie log blokad DNS.")).setNegativeButton(I18n.t(this,"Anuluj"),null).setPositiveButton(I18n.t(this,"WYCZYŚĆ"),(d,w)->{SystemLogStore.clear(this);SystemLogStore.info(this,"CONSOLE","Log wyczyszczony przez użytkownika");refresh();}).show());
        addSpace(root,12);

        LinearLayout console=card(surface,18); root.addView(console,lpMatchWrap()); console.addView(tv("ZDARZENIA",15,text,true)); infoText=tv("",12,muted,false); console.addView(infoText); addSpace(console,6); logBox=new LinearLayout(this); logBox.setOrientation(LinearLayout.VERTICAL); console.addView(logBox,lpMatchWrap());
        addSpace(root,12);
        Button back=button("← WRÓĆ DO xADKILLER",surface2,text); back.setOnClickListener(v->finish()); root.addView(back,lpMatch(dp(50)));
        setContentView(scroll);
        localize();
    }

    private void refresh() {
        PrivateDnsHelper.Snapshot s=PrivateDnsHelper.inspect(this);
        privateDnsText.setText(I18n.dynamic(this,"Prywatny DNS: "+s.pretty()));
        privateDnsText.setTextColor(s.isStrict()?getColor(R.color.swir_red):getColor(R.color.swir_green));
        String dns=s.dnsServers.isEmpty()?"brak":""+s.dnsServers;
        networkText.setText(I18n.dynamic(this,"Sieć: "+(s.networkAvailable?"dostępna":"brak aktywnej sieci")+" • DNS: "+dns));

        SharedPreferences p=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        long hb=p.getLong(SmartAdAccessibilityService.KEY_HEARTBEAT,0);
        long age=hb<=0?-1:System.currentTimeMillis()-hb;
        long det=p.getLong(SmartAdAccessibilityService.KEY_DETECTIONS,0), act=p.getLong(SmartAdAccessibilityService.KEY_ACTIONS,0);
        boolean smart=p.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,true);
        String noHeartbeat=I18n.language(this).equals("pl")?"brak":"none";
        smartText.setText(I18n.dynamic(this,"Smart Engine: "+(smart?"ON":"OFF")+" • heartbeat="+(age<0?noHeartbeat:age+" ms")+" • wykrycia="+det+" • akcje="+act));
        smartText.setTextColor(smart && age>=0 && age<15000?getColor(R.color.swir_green):getColor(R.color.swir_muted));

        List<SystemLogStore.Entry> entries=SystemLogStore.readRecent(this,500); logBox.removeAllViews();
        int shown=0;
        DateFormat df=DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.MEDIUM,Locale.getDefault());
        for(SystemLogStore.Entry e:entries){
            if(errorsOnly && !("ERROR".equals(e.level)||"WARN".equals(e.level))) continue;
            shown++;
            int accent=colorFor(e.level);
            LinearLayout card=card(getColor(R.color.swir_surface_2),12); LinearLayout.LayoutParams lp=lpMatchWrap(); lp.setMargins(0,0,0,dp(7)); logBox.addView(card,lp);
            TextView top=tv(df.format(new Date(e.time))+"  •  "+e.level+" / "+e.category,10,accent,true); card.addView(top);
            card.addView(tv(I18n.dynamic(this,e.message),13,getColor(R.color.swir_text),false));
            if(!e.detail.isEmpty()) { TextView detail=tv(e.detail,11,getColor(R.color.swir_muted),false); detail.setTextIsSelectable(true); card.addView(detail); }
        }
        infoText.setText(I18n.dynamic(this,shown+" wpisów"+(errorsOnly?" • filtr: WARN/ERROR":"")+" • maks. 500 pokazanych"));
        if(shown==0) logBox.addView(tv("Brak wpisów dla wybranego filtra.",13,getColor(R.color.swir_muted),false));
        localize();
    }

    private void runNetworkTest() {
        Toast.makeText(this,I18n.t(this,"Testuję DNS i internet…"),Toast.LENGTH_SHORT).show();
        SystemLogStore.info(this,"DIAG","Rozpoczęto test sieci");
        new Thread(()->{
            long start=System.currentTimeMillis();
            try {
                InetAddress a=InetAddress.getByName("example.com");
                InetAddress b=InetAddress.getByName("github.com");
                long ms=System.currentTimeMillis()-start;
                SystemLogStore.add(this,"INFO","DIAG","Test DNS OK • "+ms+" ms","example.com="+a.getHostAddress()+" • github.com="+b.getHostAddress());
                runOnUiThread(()->{Toast.makeText(this,I18n.dynamic(this,"DNS działa • "+ms+" ms"),Toast.LENGTH_LONG).show();refresh();});
            } catch(Exception e) {
                SystemLogStore.error(this,"DIAG","Test DNS NIEUDANY",e);
                runOnUiThread(()->{Toast.makeText(this,I18n.t(this,"Test DNS nieudany — zobacz konsolę."),Toast.LENGTH_LONG).show();refresh();});
            }
        },"xADKiller-Diagnostics").start();
    }

    private void copyReport() {
        List<SystemLogStore.Entry> entries=SystemLogStore.readRecent(this,300);
        PrivateDnsHelper.Snapshot s=PrivateDnsHelper.inspect(this);
        SharedPreferences p=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        StringBuilder b=new StringBuilder();
        b.append("xADKiller 1.5.0 SYSTEM REPORT\n");
        b.append("App language: ").append(I18n.languageName(this)).append(" (system=").append(I18n.rawSystemLanguage(this)).append(")\n");
        b.append("Private DNS: ").append(s.pretty()).append("\n");
        b.append("Network: ").append(s.networkAvailable).append(" DNS=").append(s.dnsServers).append("\n");
        b.append("Smart enabled: ").append(p.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,true)).append("\n");
        b.append("Smart heartbeat: ").append(p.getLong(SmartAdAccessibilityService.KEY_HEARTBEAT,0)).append("\n");
        b.append("Smart detections/actions: ").append(p.getLong(SmartAdAccessibilityService.KEY_DETECTIONS,0)).append('/').append(p.getLong(SmartAdAccessibilityService.KEY_ACTIONS,0)).append("\n\n");
        DateFormat df=DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.MEDIUM,Locale.getDefault());
        for(SystemLogStore.Entry e:entries){b.append(df.format(new Date(e.time))).append(" | ").append(e.level).append(" | ").append(e.category).append(" | ").append(e.message);if(!e.detail.isEmpty())b.append(" | ").append(e.detail);b.append('\n');}
        ClipboardManager cm=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE); if(cm!=null){cm.setPrimaryClip(ClipData.newPlainText("xADKiller report",b.toString()));Toast.makeText(this,I18n.t(this,"Raport skopiowany."),Toast.LENGTH_SHORT).show();}
    }

    private void localize(){try{I18n.apply(this,getWindow().getDecorView());}catch(Throwable ignored){}}
    private int colorFor(String level){if("ERROR".equals(level))return getColor(R.color.swir_red);if("WARN".equals(level))return 0xffffb74d;if("BLOCK".equals(level)||"SMART".equals(level))return getColor(R.color.swir_cyan);if("DNS".equals(level))return getColor(R.color.swir_blue);return getColor(R.color.swir_green);}
    private TextView tv(String value,float sp,int color,boolean bold){TextView v=new TextView(this);v.setText(I18n.t(this,value));v.setTextSize(sp);v.setTextColor(color);v.setLineSpacing(0,1.08f);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;}
    private Button button(String text,int bg,int fg){Button b=new Button(this);b.setText(I18n.t(this,text));b.setTextColor(fg);b.setTextSize(12);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setAllCaps(false);b.setPadding(dp(8),0,dp(8),0);b.setBackground(round(bg,13));return b;}
    private LinearLayout card(int bg,int radiusDp){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(15),dp(13),dp(15),dp(13));c.setBackground(round(bg,radiusDp));return c;}
    private GradientDrawable round(int color,int radiusDp){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radiusDp));return d;}
    private LinearLayout.LayoutParams lpMatchWrap(){return new LinearLayout.LayoutParams(-1,-2);} private LinearLayout.LayoutParams lpMatch(int h){return new LinearLayout.LayoutParams(-1,h);} private void addSpace(LinearLayout p,int d){Space s=new Space(this);p.addView(s,new LinearLayout.LayoutParams(1,dp(d)));} private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}
