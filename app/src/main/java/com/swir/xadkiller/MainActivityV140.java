package com.swir.xadkiller;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.accessibility.AccessibilityManager;
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

public class MainActivityV140 extends Activity {
    private static final int REQ_VPN = 4001;
    private static final int REQ_NOTIFICATIONS = 4002;

    private TextView vpnStatus, dnsStats, domainCount, lastBlocked, listInfo, privateDns, smartStatus, smartStats, aiStats;
    private Button vpnButton, updateButton;
    private EditText domainInput;
    private boolean receiverRegistered;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            boolean running = intent.getBooleanExtra(AdBlockVpnServiceV121.EXTRA_RUNNING, false);
            long queries = intent.getLongExtra(AdBlockVpnServiceV121.EXTRA_QUERIES, 0);
            long blocked = intent.getLongExtra(AdBlockVpnServiceV121.EXTRA_BLOCKED, 0);
            int domains = intent.getIntExtra(AdBlockVpnServiceV121.EXTRA_DOMAINS, BlocklistManager.currentCount());
            String last = intent.getStringExtra(AdBlockVpnServiceV121.EXTRA_LAST);
            renderVpn(running, queries, blocked, domains, last);
            localize();
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            BlocklistManager.bootstrap(this);
            AdaptiveLearningEngine.load(this);
            CommunityLearningManager.load(this);
            buildUi();
            renderAll();
            loadFullListAsync();
            localize();
            SystemLogStore.info(this, "UI", "MainActivityV140 uruchomiona • lang=" + I18n.language(this) + " • system=" + I18n.rawSystemLanguage(this));
        } catch (Throwable t) {
            SystemLogStore.error(this, "UI", "Błąd startu MainActivityV140", t);
            showSafeMode(t);
        }
    }

    @Override protected void onStart() {
        super.onStart();
        if (!receiverRegistered) {
            IntentFilter f = new IntentFilter(AdBlockVpnServiceV121.ACTION_STATUS);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(receiver, f);
            receiverRegistered = true;
        }
        renderAll();
        localize();
    }

    @Override protected void onResume() {
        super.onResume();
        renderSmart();
        renderAi();
        renderPrivateDns();
        localize();
    }

    @Override protected void onStop() {
        if (receiverRegistered) {
            try { unregisterReceiver(receiver); } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        super.onStop();
    }

    private void buildUi() {
        int bg=c(R.color.swir_bg), surface=c(R.color.swir_surface), surface2=c(R.color.swir_surface_2), blue=c(R.color.swir_blue), green=c(R.color.swir_green), text=c(R.color.swir_text), muted=c(R.color.swir_muted), red=c(R.color.swir_red);
        ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(bg);scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(18),dp(16),dp(18),dp(28));scroll.addView(root,new ScrollView.LayoutParams(-1,-2));

        LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);root.addView(header,wrap());
        ImageView icon=new ImageView(this);icon.setImageResource(R.drawable.ic_launcher);LinearLayout.LayoutParams ip=new LinearLayout.LayoutParams(dp(66),dp(66));ip.setMarginEnd(dp(12));header.addView(icon,ip);
        LinearLayout names=new LinearLayout(this);names.setOrientation(LinearLayout.VERTICAL);header.addView(names,new LinearLayout.LayoutParams(0,-2,1));
        TextView title=tv("xADKILLER",29,text,true);title.setLetterSpacing(.07f);names.addView(title);names.addView(tv("DNS + SMART + ADAPTIVE AI • BY SWIR",11,blue,true));names.addView(tv(I18n.languageStatus(this),10,muted,false));gap(root,12);

        LinearLayout vpn=card(surface);root.addView(vpn,wrap());vpn.addView(section("OCHRONA DNS / VPN",muted));
        vpnStatus=tv("WYŁĄCZONA",23,red,true);vpn.addView(vpnStatus);vpn.addView(tv("Warstwa 1: lokalny VPN/DNS blokuje domeny reklam, trackerów i malware.",12,muted,false));gap(vpn,9);
        vpnButton=button("WŁĄCZ OCHRONĘ",blue,Color.BLACK);vpnButton.setOnClickListener(v->toggleVpn());vpn.addView(vpnButton,h(50));gap(root,9);

        LinearLayout smart=card(surface);root.addView(smart,wrap());smart.addView(section("SMART AD ENGINE",muted));
        smartStatus=tv("Sprawdzanie…",14,text,true);smart.addView(smartStatus);smartStats=tv("0 wykryć • 0 akcji",12,muted,false);smart.addView(smartStats);
        SharedPreferences p=prefs();
        Switch smartOn=toggle("Smart detection",p.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,true),text);smartOn.setOnCheckedChangeListener((x,on)->{p.edit().putBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,on).apply();renderSmart();localize();});smart.addView(smartOn,wrap());
        Switch skip=toggle("Auto-pomiń wyraźny przycisk reklamy",p.getBoolean(SmartAdAccessibilityService.KEY_AUTO_SKIP,true),text);skip.setOnCheckedChangeListener((x,on)->p.edit().putBoolean(SmartAdAccessibilityService.KEY_AUTO_SKIP,on).apply());smart.addView(skip,wrap());
        Switch mute=toggle("Wyciszaj mocno wykrytą reklamę audio",p.getBoolean(SmartAdAccessibilityService.KEY_MUTE_ADS,false),text);mute.setOnCheckedChangeListener((x,on)->p.edit().putBoolean(SmartAdAccessibilityService.KEY_MUTE_ADS,on).apply());smart.addView(mute,wrap());gap(smart,6);
        Button access=button("USTAWIENIA SMART ENGINE",surface2,text);access.setOnClickListener(v->openAccessibility());smart.addView(access,h(46));gap(root,9);

        LinearLayout ai=card(surface);root.addView(ai,wrap());ai.addView(section("ADAPTIVE AI • UCZENIE",muted));
        ai.addView(tv("Lokalny model uczy się z Twojego feedbacku i udanych Auto-Skip. Community Intelligence pobiera tylko publiczne reguły EasyList/AdGuard — nie wykonuje obcego kodu.",12,muted,false));gap(ai,6);
        aiStats=tv("Sprawdzanie modelu…",12,blue,false);ai.addView(aiStats);gap(ai,8);
        Button aiLab=button("OTWÓRZ ADAPTIVE AI LAB",blue,Color.BLACK);aiLab.setOnClickListener(v->startActivity(new Intent(this,AdaptiveAiActivity.class)));ai.addView(aiLab,h(50));gap(root,9);

        LinearLayout compatibility=card(surface);root.addView(compatibility,wrap());compatibility.addView(section("PRYWATNY DNS",muted));privateDns=tv("Sprawdzanie…",12,text,false);compatibility.addView(privateDns);gap(compatibility,6);
        Button dnsSettings=button("USTAWIENIA PRYWATNEGO DNS",surface2,text);dnsSettings.setOnClickListener(v->openPrivateDns());compatibility.addView(dnsSettings,h(46));gap(root,9);

        LinearLayout stats=card(surface);root.addView(stats,wrap());stats.addView(section("STATYSTYKI DNS",muted));dnsStats=tv("0 zablokowanych • 0 zapytań",18,green,true);stats.addView(dnsStats);domainCount=tv("0 domen na liście",12,text,false);stats.addView(domainCount);lastBlocked=tv("Ostatnia blokada: —",12,muted,false);stats.addView(lastBlocked);gap(root,9);

        LinearLayout lists=card(surface);root.addView(lists,wrap());lists.addView(section("LISTY / ULTRA",muted));
        Switch ultra=toggle("Tryb PRO / ULTRA",p.getBoolean(BlocklistManager.KEY_STRICT,false),text);ultra.setOnCheckedChangeListener((x,on)->{p.edit().putBoolean(BlocklistManager.KEY_STRICT,on).apply();SystemLogStore.info(this,"UI","DNS mode="+(on?"ULTRA":"STANDARD"));updateLists();});lists.addView(ultra,wrap());
        listInfo=tv("",12,muted,false);lists.addView(listInfo);gap(lists,6);
        updateButton=button("AKTUALIZUJ LISTY",surface2,text);updateButton.setOnClickListener(v->updateLists());lists.addView(updateButton,h(46));gap(lists,6);
        Button reset=button("AWARYJNY RESET CACHE / ULTRA",surface2,text);reset.setOnClickListener(v->confirmReset());lists.addView(reset,h(46));gap(root,9);

        LinearLayout custom=card(surface);root.addView(custom,wrap());custom.addView(section("WŁASNA DOMENA",muted));
        domainInput=new EditText(this);domainInput.setTextColor(text);domainInput.setHintTextColor(muted);domainInput.setHint("ads.example.com");domainInput.setSingleLine(true);domainInput.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);domainInput.setBackground(round(surface2,11));domainInput.setPadding(dp(12),0,dp(12),0);custom.addView(domainInput,h(46));gap(custom,6);
        LinearLayout rules=new LinearLayout(this);custom.addView(rules,wrap());Button block=button("BLOKUJ",red,Color.WHITE), allow=button("ZEZWÓL",green,Color.BLACK);LinearLayout.LayoutParams a=new LinearLayout.LayoutParams(0,dp(46),1);a.setMarginEnd(dp(4));LinearLayout.LayoutParams b=new LinearLayout.LayoutParams(0,dp(46),1);b.setMarginStart(dp(4));rules.addView(block,a);rules.addView(allow,b);block.setOnClickListener(v->addRule(true));allow.setOnClickListener(v->addRule(false));gap(root,9);

        Button console=button("SYSTEM CONSOLE • AI / SMART / BŁĘDY",blue,Color.BLACK);console.setOnClickListener(v->startActivity(new Intent(this,SystemConsoleActivity.class)));root.addView(console,h(50));gap(root,7);
        Button github=button("GITHUB • github.com/Swir/xADKiller",surface2,text);github.setOnClickListener(v->openUrl("https://github.com/Swir/xADKiller"));root.addView(github,h(48));gap(root,10);
        TextView footer=tv("xADKiller 1.5.0 • Multi-Language • Adaptive AI • BY SWIR",11,muted,false);footer.setGravity(Gravity.CENTER);root.addView(footer,wrap());
        setContentView(scroll);
        I18n.apply(this, scroll);
    }

    private void renderAll() {
        boolean running=hasFreshVpn();
        renderVpn(running,0,0,BlocklistManager.currentCount(),"—");
        renderPrivateDns();renderSmart();renderAi();renderListInfo();
        localize();
    }

    private void renderVpn(boolean running,long queries,long blocked,int domains,String last) {
        if(vpnStatus==null)return;
        if(running){vpnStatus.setText(I18n.t(this,"AKTYWNA"));vpnStatus.setTextColor(c(R.color.swir_green));vpnButton.setText(I18n.t(this,"WYŁĄCZ OCHRONĘ"));vpnButton.setBackground(round(c(R.color.swir_red),12));vpnButton.setTextColor(Color.WHITE);}
        else{vpnStatus.setText(I18n.t(this,"WYŁĄCZONA"));vpnStatus.setTextColor(c(R.color.swir_red));vpnButton.setText(I18n.t(this,"WŁĄCZ OCHRONĘ"));vpnButton.setBackground(round(c(R.color.swir_blue),12));vpnButton.setTextColor(Color.BLACK);}
        dnsStats.setText(I18n.dynamic(this,blocked+" zablokowanych • "+queries+" zapytań"));domainCount.setText(I18n.dynamic(this,domains+" domen na liście"));lastBlocked.setText(I18n.dynamic(this,"Ostatnia blokada: "+(last==null?"—":last)));
    }

    private boolean hasFreshVpn(){SharedPreferences p=prefs();long hb=p.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT,0);boolean r=p.getBoolean("running",false);boolean fresh=r&&hb>0&&System.currentTimeMillis()-hb<12000;if(r&&!fresh)p.edit().putBoolean("running",false).putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT,0).apply();return fresh;}

    private void renderPrivateDns(){if(privateDns==null)return;PrivateDnsHelper.Snapshot s=PrivateDnsHelper.inspect(this);privateDns.setText(I18n.dynamic(this,(s.isStrict()?"⚠ STRICT • ":"OK • ")+s.pretty()+" • DNS: "+s.dnsServers));privateDns.setTextColor(s.isStrict()?c(R.color.swir_red):c(R.color.swir_green));}

    private void renderSmart(){
        if(smartStatus==null)return;SharedPreferences p=prefs();boolean service=isSmartEnabled();boolean detector=p.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,true);long hb=p.getLong(SmartAdAccessibilityService.KEY_HEARTBEAT,0);boolean live=service&&hb>0&&System.currentTimeMillis()-hb<15000;
        if(!service){smartStatus.setText(I18n.t(this,"⚠ Usługa Accessibility wyłączona"));smartStatus.setTextColor(c(R.color.swir_red));}
        else if(!detector){smartStatus.setText(I18n.t(this,"Usługa aktywna • detection wyłączone"));smartStatus.setTextColor(c(R.color.swir_muted));}
        else{smartStatus.setText(I18n.t(this,live?"AKTYWNY • analizuje aplikacje":"WŁĄCZONY • oczekiwanie na zdarzenie"));smartStatus.setTextColor(live?c(R.color.swir_green):c(R.color.swir_blue));}
        smartStats.setText(I18n.dynamic(this,p.getLong(SmartAdAccessibilityService.KEY_DETECTIONS,0)+" wykryć • "+p.getLong(SmartAdAccessibilityService.KEY_ACTIONS,0)+" akcji"));
    }

    private void renderAi(){if(aiStats==null)return;AdaptiveLearningEngine.Stats s=AdaptiveLearningEngine.stats(this);int community=CommunityLearningManager.count(this);aiStats.setText(I18n.dynamic(this,(AdaptiveLearningEngine.isEnabled(this)?"AI aktywne":"AI wyłączone")+" • feedback="+s.samples+" • model="+s.modelFeatures+" cech • Community="+community));}

    private void renderListInfo(){if(listInfo==null)return;long t=prefs().getLong(BlocklistManager.KEY_LAST_UPDATE,0);listInfo.setText(t<=0?I18n.t(this,"Wbudowana lista startowa."):I18n.dynamic(this,"Ostatnia aktualizacja: "+DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT,Locale.getDefault()).format(new Date(t))));}

    private void toggleVpn(){
        if(hasFreshVpn()){try{startService(new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_STOP));}catch(Exception e){SystemLogStore.error(this,"VPN","STOP failed",e);}return;}
        PrivateDnsHelper.Snapshot s=PrivateDnsHelper.inspect(this);
        if(s.isStrict()){new AlertDialog.Builder(this).setTitle(I18n.t(this,"Konflikt z Prywatnym DNS")).setMessage(I18n.t(this,"Masz STRICT Private DNS. Najlepiej ustaw Automatyczny albo Wyłączony.")).setNegativeButton(I18n.t(this,"Anuluj"),null).setPositiveButton(I18n.t(this,"Ustawienia"),(d,w)->openPrivateDns()).setNeutralButton(I18n.t(this,"Uruchom mimo to"),(d,w)->prepareVpn()).show();return;}
        prepareVpn();
    }

    private void prepareVpn(){if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},REQ_NOTIFICATIONS);Intent p=VpnService.prepare(this);if(p!=null)startActivityForResult(p,REQ_VPN);else startVpnService();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==REQ_VPN&&result==RESULT_OK)startVpnService();}
    private void startVpnService(){try{Intent i=new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_START);if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);vpnStatus.setText(I18n.t(this,"URUCHAMIANIE…"));}catch(Exception e){SystemLogStore.error(this,"VPN","Start failed",e);Toast.makeText(this,I18n.t(this,"Błąd startu — sprawdź SYSTEM CONSOLE."),Toast.LENGTH_LONG).show();}}

    private void updateLists(){if(updateButton==null||!updateButton.isEnabled())return;updateButton.setEnabled(false);updateButton.setText(I18n.t(this,"POBIERANIE…"));new Thread(()->{try{int n=BlocklistManager.updateRemote(getApplicationContext());SystemLogStore.info(this,"BLOCKLIST","Update OK • "+n);runOnUiThread(()->{updateButton.setEnabled(true);updateButton.setText(I18n.t(this,"AKTUALIZUJ LISTY"));domainCount.setText(I18n.dynamic(this,n+" domen na liście"));renderListInfo();reloadVpn();localize();});}catch(Throwable t){SystemLogStore.error(this,"BLOCKLIST","Update failed",t);runOnUiThread(()->{updateButton.setEnabled(true);updateButton.setText(I18n.t(this,"AKTUALIZUJ LISTY"));Toast.makeText(this,I18n.t(this,"Błąd list — zobacz konsolę."),Toast.LENGTH_LONG).show();localize();});}},"xADKiller-ListUpdate").start();}
    private void reloadVpn(){if(!hasFreshVpn())return;try{startService(new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_RELOAD));}catch(Exception e){SystemLogStore.error(this,"VPN","Reload failed",e);}}

    private void addRule(boolean block){String d=BlocklistManager.normalize(domainInput.getText().toString());if(d==null){Toast.makeText(this,I18n.t(this,"Podaj poprawną domenę."),Toast.LENGTH_LONG).show();return;}if(block)BlocklistManager.addCustomBlock(this,d);else BlocklistManager.addAllow(this,d);domainInput.setText("");domainCount.setText(I18n.dynamic(this,BlocklistManager.currentCount()+" domen na liście"));reloadVpn();}

    private void confirmReset(){new AlertDialog.Builder(this).setTitle(I18n.t(this,"Reset cache / ULTRA?")).setMessage(I18n.t(this,"Usunie pobraną dużą listę i wyłączy ULTRA. Własne reguły zostaną zachowane.")).setNegativeButton(I18n.t(this,"Anuluj"),null).setPositiveButton("RESET",(d,w)->{try{startService(new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_STOP));}catch(Exception ignored){}BlocklistManager.clearRemoteCache(this);renderAll();Toast.makeText(this,I18n.t(this,"Cache zresetowany."),Toast.LENGTH_LONG).show();}).show();}

    private void loadFullListAsync(){new Thread(()->{try{int n=BlocklistManager.load(getApplicationContext());runOnUiThread(()->{if(domainCount!=null)domainCount.setText(I18n.dynamic(this,n+" domen na liście"));localize();});}catch(Throwable t){SystemLogStore.error(this,"BLOCKLIST","Startup load failed",t);}},"xADKiller-StartupList").start();}

    private boolean isSmartEnabled(){try{AccessibilityManager am=(AccessibilityManager)getSystemService(ACCESSIBILITY_SERVICE);if(am==null||!am.isEnabled())return false;List<AccessibilityServiceInfo> list=am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);for(AccessibilityServiceInfo i:list){if(i==null||i.getResolveInfo()==null||i.getResolveInfo().serviceInfo==null)continue;ServiceInfo s=i.getResolveInfo().serviceInfo;if(getPackageName().equals(s.packageName)&&s.name!=null&&s.name.endsWith("SmartAdAccessibilityService"))return true;}}catch(Throwable t){SystemLogStore.error(this,"SMART","State read failed",t);}return false;}

    private void openAccessibility(){try{startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));Toast.makeText(this,I18n.t(this,"Włącz „xADKiller Smart Ad Engine”."),Toast.LENGTH_LONG).show();}catch(Exception e){SystemLogStore.error(this,"SMART","Settings failed",e);}}
    private void openPrivateDns(){try{startActivity(PrivateDnsHelper.settingsIntent());}catch(Exception e){SystemLogStore.error(this,"DNS","Settings failed",e);}}
    private void openUrl(String u){try{startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));}catch(Exception e){Toast.makeText(this,I18n.t(this,"Nie można otworzyć linku."),Toast.LENGTH_SHORT).show();}}

    private void showSafeMode(Throwable t){LinearLayout r=new LinearLayout(this);r.setOrientation(LinearLayout.VERTICAL);r.setPadding(dp(22),dp(38),dp(22),dp(22));r.setBackgroundColor(c(R.color.swir_bg));r.addView(tv("xADKILLER • SAFE MODE",24,c(R.color.swir_red),true));r.addView(tv(t.getClass().getSimpleName()+": "+t.getMessage(),12,c(R.color.swir_muted),false));gap(r,12);Button ai=button("ADAPTIVE AI LAB",c(R.color.swir_blue),Color.BLACK);ai.setOnClickListener(v->startActivity(new Intent(this,AdaptiveAiActivity.class)));r.addView(ai,h(48));gap(r,7);Button con=button("SYSTEM CONSOLE",c(R.color.swir_blue),Color.BLACK);con.setOnClickListener(v->startActivity(new Intent(this,SystemConsoleActivity.class)));r.addView(con,h(48));setContentView(r);localize();}

    private void localize(){try{I18n.apply(this,getWindow().getDecorView());}catch(Throwable ignored){}}
    private SharedPreferences prefs(){return getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);}
    private int c(int id){return getColor(id);}
    private TextView section(String s,int color){TextView v=tv(s,11,color,true);v.setLetterSpacing(.09f);return v;}
    private TextView tv(String s,float sp,int color,boolean bold){TextView v=new TextView(this);v.setText(I18n.t(this,s));v.setTextSize(sp);v.setTextColor(color);v.setLineSpacing(0,1.08f);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;}
    private Switch toggle(String text,boolean checked,int color){Switch s=new Switch(this);s.setText(I18n.t(this,text));s.setTextColor(color);s.setChecked(checked);return s;}
    private Button button(String text,int bg,int fg){Button b=new Button(this);b.setText(I18n.t(this,text));b.setTextColor(fg);b.setTextSize(12);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setAllCaps(false);b.setPadding(dp(8),0,dp(8),0);b.setBackground(round(bg,12));return b;}
    private LinearLayout card(int bg){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(14),dp(12),dp(14),dp(12));c.setBackground(round(bg,18));return c;}
    private GradientDrawable round(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private LinearLayout.LayoutParams wrap(){return new LinearLayout.LayoutParams(-1,-2);}
    private LinearLayout.LayoutParams h(int value){return new LinearLayout.LayoutParams(-1,dp(value));}
    private void gap(LinearLayout p,int value){Space s=new Space(this);p.addView(s,new LinearLayout.LayoutParams(1,dp(value)));}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}
