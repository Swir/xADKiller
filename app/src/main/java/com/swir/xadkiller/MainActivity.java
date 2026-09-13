package com.swir.xadkiller;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.text.DateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_VPN = 4001;
    private static final int REQ_NOTIFICATIONS = 4002;
    private TextView statusText, statsText, domainsText, lastBlockedText, updateText, consoleInfo;
    private LinearLayout consoleBox;
    private Button mainButton, updateButton;
    private EditText domainInput;
    private boolean receiverRegistered, running;
    private long lastRenderedBlocked = -1;

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            running = intent.getBooleanExtra(AdBlockVpnService.EXTRA_RUNNING, false);
            long queries = intent.getLongExtra(AdBlockVpnService.EXTRA_QUERIES, 0);
            long blocked = intent.getLongExtra(AdBlockVpnService.EXTRA_BLOCKED, 0);
            int domains = intent.getIntExtra(AdBlockVpnService.EXTRA_DOMAINS, BlocklistManager.currentCount());
            String last = intent.getStringExtra(AdBlockVpnService.EXTRA_LAST);
            renderStatus(running, queries, blocked, domains, last);
            if (blocked != lastRenderedBlocked) { lastRenderedBlocked = blocked; renderLogs(); }
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState); BlocklistManager.load(this); buildUi();
        SharedPreferences prefs = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE);
        running = prefs.getBoolean("running", false);
        renderStatus(running, 0, 0, BlocklistManager.currentCount(), "—"); renderLastUpdate(); renderLogs();
    }

    @Override protected void onStart() {
        super.onStart();
        if (!receiverRegistered) {
            IntentFilter f = new IntentFilter(AdBlockVpnService.ACTION_STATUS);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(statusReceiver, f);
            receiverRegistered = true;
        }
        renderLogs();
    }

    @Override protected void onStop() { if (receiverRegistered) { unregisterReceiver(statusReceiver); receiverRegistered = false; } super.onStop(); }

    private void buildUi() {
        int bg=getColor(R.color.swir_bg), surface=getColor(R.color.swir_surface), surface2=getColor(R.color.swir_surface_2), blue=getColor(R.color.swir_blue), green=getColor(R.color.swir_green), text=getColor(R.color.swir_text), muted=getColor(R.color.swir_muted), red=getColor(R.color.swir_red);
        ScrollView scroll=new ScrollView(this); scroll.setBackgroundColor(bg); scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(20),dp(18),dp(20),dp(30)); scroll.addView(root,new ScrollView.LayoutParams(-1,-2));

        LinearLayout header=new LinearLayout(this); header.setOrientation(LinearLayout.HORIZONTAL); header.setGravity(Gravity.CENTER_VERTICAL); root.addView(header,lpMatchWrap());
        ImageView icon=new ImageView(this); icon.setImageResource(R.drawable.ic_launcher); LinearLayout.LayoutParams ilp=new LinearLayout.LayoutParams(dp(72),dp(72)); ilp.setMarginEnd(dp(14)); header.addView(icon,ilp);
        LinearLayout titles=new LinearLayout(this); titles.setOrientation(LinearLayout.VERTICAL); header.addView(titles,new LinearLayout.LayoutParams(0,-2,1));
        TextView title=tv("xADKILLER",29,text,true); title.setLetterSpacing(.08f); titles.addView(title);
        TextView by=tv("SYSTEMOWY AD BLOCKER • BY SWIR",12,blue,true); by.setLetterSpacing(.05f); titles.addView(by);
        addSpace(root,16);

        LinearLayout statusCard=card(surface,20); root.addView(statusCard,lpMatchWrap()); statusCard.addView(label("OCHRONA",muted));
        statusText=tv("WYŁĄCZONA",24,red,true); statusCard.addView(statusText);
        statusCard.addView(tv("Lokalny VPN przechwytuje DNS. xADKiller nie wysyła całego ruchu przez zewnętrzny serwer VPN.",13,muted,false));
        addSpace(statusCard,12); mainButton=button("WŁĄCZ OCHRONĘ",blue,Color.BLACK); mainButton.setOnClickListener(v->toggleProtection()); statusCard.addView(mainButton,lpMatch(dp(52)));
        addSpace(root,12);

        LinearLayout statsCard=card(surface,20); root.addView(statsCard,lpMatchWrap()); statsCard.addView(label("STATYSTYKI",muted));
        statsText=tv("0 zablokowanych • 0 zapytań",20,green,true); statsCard.addView(statsText); domainsText=tv(BlocklistManager.currentCount()+" domen na liście",14,text,false); statsCard.addView(domainsText);
        lastBlockedText=tv("Ostatnia blokada: —",13,muted,false); statsCard.addView(lastBlockedText);
        addSpace(root,12);

        LinearLayout modeCard=card(surface,20); root.addView(modeCard,lpMatchWrap()); modeCard.addView(tv("TRYB BLOKOWANIA",16,text,true));
        modeCard.addView(tv("Standard: StevenBlack + AdAway. PRO: dodatkowo HaGeZi Pro — szersze blokowanie reklam, trackerów, telemetryki i złośliwych domen.",13,muted,false));
        SharedPreferences prefs=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        Switch pro=new Switch(this); pro.setText("Tryb PRO / agresywny"); pro.setTextColor(text); pro.setTextSize(14); pro.setChecked(prefs.getBoolean(BlocklistManager.KEY_STRICT,false));
        pro.setOnCheckedChangeListener((b,on)->{ prefs.edit().putBoolean(BlocklistManager.KEY_STRICT,on).apply(); Toast.makeText(this,"Tryb "+(on?"PRO":"Standard")+" zapisany. Aktualizuję listę…",Toast.LENGTH_LONG).show(); updateBlocklist(); });
        modeCard.addView(pro,lpMatchWrap());
        addSpace(root,12);

        LinearLayout listCard=card(surface,20); root.addView(listCard,lpMatchWrap()); listCard.addView(tv("LISTY OCHRONY",16,text,true));
        updateButton=button("AKTUALIZUJ LISTY",surface2,text); updateButton.setOnClickListener(v->updateBlocklist()); listCard.addView(updateButton,lpMatch(dp(50))); updateText=tv("",12,muted,false); listCard.addView(updateText);
        addSpace(root,12);

        LinearLayout consoleCard=card(surface,20); root.addView(consoleCard,lpMatchWrap()); consoleCard.addView(tv("KONSOLA BLOKAD",16,text,true));
        consoleCard.addView(tv("Pokazuje ostatnie blokady: czas, aplikację/UID, pakiet, domenę i powód. Identyfikacja aplikacji działa najlepiej na Androidzie 10+.",12,muted,false)); addSpace(consoleCard,8);
        LinearLayout consoleBtns=new LinearLayout(this); consoleBtns.setOrientation(LinearLayout.HORIZONTAL); consoleCard.addView(consoleBtns,lpMatchWrap());
        Button refresh=button("ODŚWIEŻ",surface2,text), clear=button("WYCZYŚĆ LOG",surface2,text); LinearLayout.LayoutParams h1=new LinearLayout.LayoutParams(0,dp(46),1); h1.setMarginEnd(dp(5)); LinearLayout.LayoutParams h2=new LinearLayout.LayoutParams(0,dp(46),1); h2.setMarginStart(dp(5)); consoleBtns.addView(refresh,h1); consoleBtns.addView(clear,h2);
        refresh.setOnClickListener(v->renderLogs()); clear.setOnClickListener(v->new AlertDialog.Builder(this).setTitle("Wyczyścić log?").setMessage("Usunie tylko lokalną historię blokad.").setNegativeButton("Anuluj",null).setPositiveButton("Wyczyść",(d,w)->{LogStore.clear(this);renderLogs();}).show());
        consoleInfo=tv("",12,muted,false); consoleCard.addView(consoleInfo); addSpace(consoleCard,6); consoleBox=new LinearLayout(this); consoleBox.setOrientation(LinearLayout.VERTICAL); consoleCard.addView(consoleBox,lpMatchWrap());
        addSpace(root,12);

        LinearLayout custom=card(surface,20); root.addView(custom,lpMatchWrap()); custom.addView(tv("WŁASNA DOMENA",16,text,true)); custom.addView(tv("Dodaj domenę do blokowanych albo jako wyjątek.",13,muted,false)); addSpace(custom,8);
        domainInput=new EditText(this); domainInput.setTextColor(text); domainInput.setHintTextColor(muted); domainInput.setHint("ads.example.com"); domainInput.setSingleLine(true); domainInput.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); domainInput.setPadding(dp(14),dp(8),dp(14),dp(8)); domainInput.setBackground(round(surface2,12)); custom.addView(domainInput,lpMatch(dp(50))); addSpace(custom,8);
        LinearLayout rules=new LinearLayout(this); rules.setOrientation(LinearLayout.HORIZONTAL); custom.addView(rules,lpMatchWrap()); Button block=button("BLOKUJ",red,Color.WHITE), allow=button("ZEZWÓL",green,Color.BLACK); LinearLayout.LayoutParams r1=new LinearLayout.LayoutParams(0,dp(48),1); r1.setMarginEnd(dp(5)); LinearLayout.LayoutParams r2=new LinearLayout.LayoutParams(0,dp(48),1); r2.setMarginStart(dp(5)); rules.addView(block,r1); rules.addView(allow,r2); block.setOnClickListener(v->addRule(true)); allow.setOnClickListener(v->addRule(false));
        addSpace(root,12);

        LinearLayout settings=card(surface,20); root.addView(settings,lpMatchWrap()); settings.addView(tv("USTAWIENIA",16,text,true)); Switch auto=new Switch(this); auto.setText("Uruchamiaj po restarcie telefonu"); auto.setTextColor(text); auto.setTextSize(14); auto.setChecked(prefs.getBoolean(BlocklistManager.KEY_AUTOSTART,true)); auto.setOnCheckedChangeListener((b,on)->prefs.edit().putBoolean(BlocklistManager.KEY_AUTOSTART,on).apply()); settings.addView(auto,lpMatchWrap());
        Button clearRules=button("WYCZYŚĆ WŁASNE REGUŁY",surface2,text); clearRules.setOnClickListener(v->new AlertDialog.Builder(this).setTitle("Wyczyścić własne reguły?").setNegativeButton("Anuluj",null).setPositiveButton("Wyczyść",(d,w)->{BlocklistManager.clearCustomRules(this);domainsText.setText(BlocklistManager.currentCount()+" domen na liście");}).show()); settings.addView(clearRules,lpMatch(dp(48)));
        addSpace(root,12);

        Button github=button("GITHUB • github.com/Swir/xADKiller",surface2,text); github.setOnClickListener(v->openUrl("https://github.com/Swir/xADKiller")); root.addView(github,lpMatch(dp(50))); addSpace(root,8);
        Button privacy=button("PRYWATNOŚĆ I OGRANICZENIA",surface2,text); privacy.setOnClickListener(v->showPrivacy()); root.addView(privacy,lpMatch(dp(50))); addSpace(root,14);
        TextView footer=tv("xADKiller 1.1.0 • No root • Local VPN/DNS • BY SWIR",11,muted,false); footer.setGravity(Gravity.CENTER); root.addView(footer,lpMatchWrap());
        setContentView(scroll);
    }

    private void renderLogs() {
        if (consoleBox==null) return; consoleBox.removeAllViews(); List<LogStore.Entry> logs=LogStore.readRecent(this,80); consoleInfo.setText(logs.size()+" ostatnich wpisów");
        if (logs.isEmpty()) { consoleBox.addView(tv("Brak blokad w logu. Włącz ochronę i używaj aplikacji — wpisy pojawią się tutaj.",13,getColor(R.color.swir_muted),false)); return; }
        DateFormat tf=DateFormat.getTimeInstance(DateFormat.MEDIUM, Locale.getDefault());
        for (LogStore.Entry e:logs) {
            LinearLayout row=card(getColor(R.color.swir_surface_2),14); LinearLayout.LayoutParams rp=lpMatchWrap(); rp.setMargins(0,0,0,dp(8)); consoleBox.addView(row,rp);
            String time=tf.format(new Date(e.time)); row.addView(tv(time+"  •  "+e.reason,11,getColor(R.color.swir_muted),false));
            TextView app=tv(e.appName+(e.uid>=0?"  [UID "+e.uid+"]":""),14,getColor(R.color.swir_text),true); row.addView(app);
            if (!e.packageName.isEmpty()) { TextView pkg=tv(e.packageName+"  ↗",12,getColor(R.color.swir_blue),false); pkg.setOnClickListener(v->openApp(e.packageName)); row.addView(pkg); }
            TextView domain=tv(e.domain+"  ↗",13,getColor(R.color.swir_cyan),true); domain.setOnClickListener(v->confirmOpenDomain(e.domain)); row.addView(domain);
        }
    }

    private void confirmOpenDomain(String domain) {
        new AlertDialog.Builder(this).setTitle("Otworzyć zablokowaną domenę?").setMessage(domain+" została zablokowana jako reklama/tracker lub podejrzana domena. Otwieraj tylko jeśli wiesz, co robisz.").setNegativeButton("Anuluj",null).setPositiveButton("Otwórz",(d,w)->openUrl("https://"+domain)).show();
    }

    private void openApp(String pkg) { try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("market://details?id="+pkg))); } catch(Exception e){ openUrl("https://play.google.com/store/apps/details?id="+pkg); } }

    private void toggleProtection() {
        if (running) { startService(new Intent(this,AdBlockVpnService.class).setAction(AdBlockVpnService.ACTION_STOP)); return; }
        if (Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},REQ_NOTIFICATIONS);
        Intent prepare=VpnService.prepare(this); if (prepare!=null) startActivityForResult(prepare,REQ_VPN); else startShieldService();
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode==REQ_VPN){if(resultCode==RESULT_OK)startShieldService();else Toast.makeText(this,"Bez zgody Androida na VPN filtr nie może działać.",Toast.LENGTH_LONG).show();}}
    private void startShieldService(){Intent i=new Intent(this,AdBlockVpnService.class).setAction(AdBlockVpnService.ACTION_START);if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);statusText.setText("URUCHAMIANIE…");statusText.setTextColor(getColor(R.color.swir_blue));}

    private void updateBlocklist(){
        updateButton.setEnabled(false);updateButton.setText("POBIERANIE…");updateText.setText("Łączenie ze źródłami…");
        new Thread(()->{try{int count=BlocklistManager.updateRemote(getApplicationContext());runOnUiThread(()->{updateButton.setEnabled(true);updateButton.setText("AKTUALIZUJ LISTY");updateText.setText("Gotowe • "+count+" domen");domainsText.setText(count+" domen na liście");renderLastUpdate();reloadService();Toast.makeText(this,"Listy zaktualizowane.",Toast.LENGTH_SHORT).show();});}catch(Exception e){runOnUiThread(()->{updateButton.setEnabled(true);updateButton.setText("AKTUALIZUJ LISTY");updateText.setText("Błąd: "+e.getMessage());Toast.makeText(this,"Nie udało się pobrać list.",Toast.LENGTH_LONG).show();});}},"xADKiller-List-Updater").start();
    }
    private void reloadService(){try{startService(new Intent(this,AdBlockVpnService.class).setAction(AdBlockVpnService.ACTION_RELOAD));}catch(Exception ignored){}}
    private void addRule(boolean block){String n=BlocklistManager.normalize(domainInput.getText().toString());if(n==null){Toast.makeText(this,"Podaj poprawną domenę.",Toast.LENGTH_LONG).show();return;}if(block)BlocklistManager.addCustomBlock(this,n);else BlocklistManager.addAllow(this,n);domainInput.setText("");domainsText.setText(BlocklistManager.currentCount()+" domen na liście");reloadService();Toast.makeText(this,block?"Dodano blokadę.":"Dodano wyjątek.",Toast.LENGTH_SHORT).show();}

    private void renderStatus(boolean isRunning,long queries,long blocked,int domains,String last){running=isRunning;if(statusText==null)return;if(isRunning){statusText.setText("AKTYWNA");statusText.setTextColor(getColor(R.color.swir_green));mainButton.setText("WYŁĄCZ OCHRONĘ");mainButton.setBackground(round(getColor(R.color.swir_red),14));mainButton.setTextColor(Color.WHITE);}else{statusText.setText("WYŁĄCZONA");statusText.setTextColor(getColor(R.color.swir_red));mainButton.setText("WŁĄCZ OCHRONĘ");mainButton.setBackground(round(getColor(R.color.swir_blue),14));mainButton.setTextColor(Color.BLACK);}statsText.setText(blocked+" zablokowanych • "+queries+" zapytań");domainsText.setText(domains+" domen na liście");lastBlockedText.setText("Ostatnia blokada: "+(last==null||last.isEmpty()?"—":last));}
    private void renderLastUpdate(){long ts=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE).getLong(BlocklistManager.KEY_LAST_UPDATE,0);if(ts<=0)updateText.setText("Wbudowana lista startowa.");else updateText.setText("Ostatnia aktualizacja: "+DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT,Locale.getDefault()).format(new Date(ts)));}

    private void showPrivacy(){new AlertDialog.Builder(this).setTitle("xADKiller — prywatność").setMessage("xADKiller nie ma reklam, kont ani SDK analitycznych. Log blokad jest przechowywany lokalnie na telefonie. Dozwolone DNS są wysyłane do 1.1.1.1, 9.9.9.9 lub 8.8.8.8.\n\nKonsola widzi domenę DNS, nie pełną ścieżkę URL HTTPS. Reklamy dostarczane z tej samej domeny co treść oraz część aplikacji używających własnego DoH mogą ominąć filtr.\n\nTryb PRO używa dodatkowej listy HaGeZi Pro.").setPositiveButton("OK",null).setNeutralButton("GitHub",(d,w)->openUrl("https://github.com/Swir/xADKiller")).show();}
    private void openUrl(String url){try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(Exception e){Toast.makeText(this,url,Toast.LENGTH_LONG).show();}}

    private TextView label(String s,int c){TextView v=tv(s,12,c,true);v.setLetterSpacing(.1f);return v;}
    private TextView tv(String value,float sp,int color,boolean bold){TextView v=new TextView(this);v.setText(value);v.setTextSize(sp);v.setTextColor(color);v.setLineSpacing(0,1.08f);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;}
    private Button button(String text,int bg,int fg){Button b=new Button(this);b.setText(text);b.setTextColor(fg);b.setTextSize(13);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setAllCaps(false);b.setPadding(dp(12),0,dp(12),0);b.setBackground(round(bg,14));return b;}
    private LinearLayout card(int bg,int radiusDp){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(16),dp(14),dp(16),dp(14));c.setBackground(round(bg,radiusDp));return c;}
    private GradientDrawable round(int color,int radiusDp){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radiusDp));return d;}
    private LinearLayout.LayoutParams lpMatchWrap(){return new LinearLayout.LayoutParams(-1,-2);} private LinearLayout.LayoutParams lpMatch(int h){return new LinearLayout.LayoutParams(-1,h);} private void addSpace(LinearLayout p,int d){Space s=new Space(this);p.addView(s,new LinearLayout.LayoutParams(1,dp(d)));} private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}
