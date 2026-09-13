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

public class MainActivityV121 extends Activity {
    private static final int REQ_VPN = 4001;
    private static final int REQ_NOTIFICATIONS = 4002;

    private TextView statusText, statsText, domainsText, lastBlockedText, updateText, privateDnsText, blockInfo, engineText;
    private TextView smartStatusText, smartStatsText;
    private LinearLayout blockBox;
    private Button mainButton, updateButton;
    private EditText domainInput;
    private boolean running, receiverRegistered;
    private long lastRenderedBlocked = -1;
    private long lastLogRenderAt;

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (i == null) return;
            running = i.getBooleanExtra(AdBlockVpnServiceV121.EXTRA_RUNNING, false);
            long q = i.getLongExtra(AdBlockVpnServiceV121.EXTRA_QUERIES, 0);
            long b = i.getLongExtra(AdBlockVpnServiceV121.EXTRA_BLOCKED, 0);
            int d = i.getIntExtra(AdBlockVpnServiceV121.EXTRA_DOMAINS, BlocklistManager.currentCount());
            String last = i.getStringExtra(AdBlockVpnServiceV121.EXTRA_LAST);
            renderStatus(q, b, d, last);
            long now = System.currentTimeMillis();
            if (b != lastRenderedBlocked && now - lastLogRenderAt > 3000) {
                lastRenderedBlocked = b;
                lastLogRenderAt = now;
                renderBlockedLogs();
            }
        }
    };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        try {
            int base = BlocklistManager.bootstrap(this);
            SystemLogStore.info(this, "UI", "Start ekranu xADKiller v1.3.0 • bootstrap=" + base);
            buildUi();
            running = hasFreshHeartbeat();
            renderStatus(0, 0, BlocklistManager.currentCount(), "—");
            renderLastUpdate();
            renderPrivateDns();
            renderBlockedLogs();
            refreshSmartStatus();
            loadFullListInBackground();
        } catch (Throwable t) {
            try { SystemLogStore.error(this, "UI", "Błąd startu ekranu głównego v1.3.0", t); } catch (Throwable ignored) {}
            showEmergencyUi(t);
        }
    }

    @Override protected void onStart() {
        super.onStart();
        if (!receiverRegistered) {
            IntentFilter f = new IntentFilter(AdBlockVpnServiceV121.ACTION_STATUS);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(statusReceiver, f);
            receiverRegistered = true;
        }
        running = hasFreshHeartbeat();
        renderPrivateDns();
        renderStatus(0, 0, BlocklistManager.currentCount(), "—");
        refreshSmartStatus();
    }

    @Override protected void onResume() {
        super.onResume();
        refreshSmartStatus();
    }

    @Override protected void onStop() {
        if (receiverRegistered) {
            try { unregisterReceiver(statusReceiver); } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        super.onStop();
    }

    private boolean hasFreshHeartbeat() {
        SharedPreferences p = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE);
        long hb = p.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0);
        boolean pref = p.getBoolean("running", false);
        boolean fresh = pref && hb > 0 && System.currentTimeMillis() - hb < 12_000;
        if (pref && !fresh) p.edit().putBoolean("running", false).putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0).apply();
        return fresh;
    }

    private void loadFullListInBackground() {
        if (engineText != null) engineText.setText("DNS: lista startowa aktywna • pełna lista ładuje się w tle…");
        new Thread(() -> {
            try {
                long start = System.currentTimeMillis();
                int count = BlocklistManager.load(getApplicationContext());
                long ms = System.currentTimeMillis() - start;
                SystemLogStore.info(this, "BLOCKLIST", "Startowe ładowanie pełnej listy zakończone • " + count + " domen • " + ms + " ms");
                runOnUiThread(() -> {
                    if (domainsText != null) domainsText.setText(count + " domen na liście");
                    if (engineText != null) engineText.setText("DNS: pełna lista gotowa • " + count + " domen • " + ms + " ms");
                });
            } catch (Throwable t) {
                SystemLogStore.error(this, "BLOCKLIST", "Pełna lista nie załadowała się — pozostaje tryb awaryjny", t);
                runOnUiThread(() -> { if (engineText != null) engineText.setText("DNS: TRYB AWARYJNY • lista startowa nadal chroni"); });
            }
        }, "xADKiller-Startup-Blocklist").start();
    }

    private void buildUi() {
        int bg=getColor(R.color.swir_bg), surface=getColor(R.color.swir_surface), surface2=getColor(R.color.swir_surface_2), blue=getColor(R.color.swir_blue), green=getColor(R.color.swir_green), text=getColor(R.color.swir_text), muted=getColor(R.color.swir_muted), red=getColor(R.color.swir_red);
        ScrollView scroll=new ScrollView(this); scroll.setBackgroundColor(bg); scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(20),dp(18),dp(20),dp(30)); scroll.addView(root,new ScrollView.LayoutParams(-1,-2));

        LinearLayout header=new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL); root.addView(header,lpWrap());
        ImageView icon=new ImageView(this); icon.setImageResource(R.drawable.ic_launcher); LinearLayout.LayoutParams ip=new LinearLayout.LayoutParams(dp(70),dp(70)); ip.setMarginEnd(dp(14)); header.addView(icon,ip);
        LinearLayout ht=new LinearLayout(this); ht.setOrientation(LinearLayout.VERTICAL); header.addView(ht,new LinearLayout.LayoutParams(0,-2,1));
        TextView title=tv("xADKILLER",29,text,true); title.setLetterSpacing(.08f); ht.addView(title); ht.addView(tv("DNS + SMART AD ENGINE • BY SWIR",12,blue,true));
        space(root,14);

        LinearLayout protection=card(surface,20); root.addView(protection,lpWrap()); protection.addView(label("OCHRONA DNS / VPN",muted));
        statusText=tv("WYŁĄCZONA",24,red,true); protection.addView(statusText);
        protection.addView(tv("Warstwa 1: lokalny VPN/DNS bez roota. Blokuje domeny reklam, trackerów i malware.",13,muted,false));
        space(protection,8); engineText=tv("DNS: uruchamianie…",12,blue,false); protection.addView(engineText);
        space(protection,10); mainButton=button("WŁĄCZ OCHRONĘ",blue,Color.BLACK); mainButton.setOnClickListener(v->toggleProtection()); protection.addView(mainButton,lpH(52));
        space(root,10);

        LinearLayout smart=card(surface,20); root.addView(smart,lpWrap()); smart.addView(tv("SMART AD ENGINE • VIDEO / AUDIO",16,text,true));
        smart.addView(tv("Warstwa 2: lokalnie analizuje elementy interfejsu aktywnej aplikacji. Rozpoznaje sygnały reklamy, może kliknąć wyraźny przycisk Pomiń/Skip Ad i opcjonalnie wyciszyć multimedia na czas mocnego wykrycia. Nie wysyła treści ekranu ani audio do chmury.",12,muted,false));
        space(smart,7);
        smartStatusText=tv("Sprawdzanie usługi…",13,muted,true); smart.addView(smartStatusText);
        smartStatsText=tv("0 wykryć • 0 akcji",12,muted,false); smart.addView(smartStatsText);
        SharedPreferences prefs=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        Switch smartEnabled=new Switch(this); smartEnabled.setText("Smart detection"); smartEnabled.setTextColor(text); smartEnabled.setChecked(prefs.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,true));
        smartEnabled.setOnCheckedChangeListener((x,on)->{prefs.edit().putBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,on).apply();SystemLogStore.info(this,"SMART","Smart detection: "+on);refreshSmartStatus();}); smart.addView(smartEnabled,lpWrap());
        Switch autoSkip=new Switch(this); autoSkip.setText("Auto-pomiń wyraźny przycisk reklamy"); autoSkip.setTextColor(text); autoSkip.setChecked(prefs.getBoolean(SmartAdAccessibilityService.KEY_AUTO_SKIP,true));
        autoSkip.setOnCheckedChangeListener((x,on)->{prefs.edit().putBoolean(SmartAdAccessibilityService.KEY_AUTO_SKIP,on).apply();SystemLogStore.info(this,"SMART","Auto-skip: "+on);}); smart.addView(autoSkip,lpWrap());
        Switch muteAds=new Switch(this); muteAds.setText("Wyciszaj mocno wykrytą reklamę audio (eksperymentalne)"); muteAds.setTextColor(text); muteAds.setChecked(prefs.getBoolean(SmartAdAccessibilityService.KEY_MUTE_ADS,false));
        muteAds.setOnCheckedChangeListener((x,on)->{prefs.edit().putBoolean(SmartAdAccessibilityService.KEY_MUTE_ADS,on).apply();SystemLogStore.info(this,"SMART","Smart Audio Mute: "+on);}); smart.addView(muteAds,lpWrap());
        space(smart,7);
        Button accessibility=button("WŁĄCZ / SPRAWDŹ SMART ENGINE",blue,Color.BLACK); accessibility.setOnClickListener(v->openAccessibilitySettings()); smart.addView(accessibility,lpH(50));
        smart.addView(tv("Android wymaga ręcznego włączenia usługi „xADKiller Smart Ad Engine” w Ułatwieniach dostępu. Auto-skip działa tylko, gdy aplikacja udostępnia odpowiedni element interfejsu.",11,muted,false));
        space(root,10);

        LinearLayout dns=card(surface,20); root.addView(dns,lpWrap()); dns.addView(tv("PRYWATNY DNS / KOMPATYBILNOŚĆ",16,text,true));
        privateDnsText=tv("Sprawdzanie…",13,muted,false); dns.addView(privateDnsText); space(dns,8);
        Button dnsSettings=button("USTAWIENIA PRYWATNEGO DNS",surface2,text); dnsSettings.setOnClickListener(v->openPrivateDnsSettings()); dns.addView(dnsSettings,lpH(48));
        space(root,10);

        LinearLayout stats=card(surface,20); root.addView(stats,lpWrap()); stats.addView(label("STATYSTYKI DNS",muted));
        statsText=tv("0 zablokowanych • 0 zapytań",20,green,true); stats.addView(statsText);
        domainsText=tv(BlocklistManager.currentCount()+" domen na liście",14,text,false); stats.addView(domainsText);
        lastBlockedText=tv("Ostatnia blokada: —",13,muted,false); stats.addView(lastBlockedText);
        space(root,10);

        LinearLayout mode=card(surface,20); root.addView(mode,lpWrap()); mode.addView(tv("TRYB BLOKOWANIA DNS",16,text,true));
        mode.addView(tv("Standard: StevenBlack + AdAway. PRO: dodatkowo HaGeZi Pro. Lista PRO jest pamięciowo zoptymalizowana.",13,muted,false));
        Switch pro=new Switch(this); pro.setText("Tryb PRO / agresywny"); pro.setTextColor(text); pro.setChecked(prefs.getBoolean(BlocklistManager.KEY_STRICT,false));
        pro.setOnCheckedChangeListener((x,on)->{prefs.edit().putBoolean(BlocklistManager.KEY_STRICT,on).apply();SystemLogStore.info(this,"UI","Tryb blokowania: "+(on?"PRO":"STANDARD"));Toast.makeText(this,"Tryb "+(on?"PRO":"Standard")+" — aktualizuję listę w tle.",Toast.LENGTH_SHORT).show();updateBlocklist();});
        mode.addView(pro,lpWrap()); space(root,10);

        LinearLayout lists=card(surface,20); root.addView(lists,lpWrap()); lists.addView(tv("LISTY OCHRONY",16,text,true));
        updateButton=button("AKTUALIZUJ LISTY",surface2,text); updateButton.setOnClickListener(v->updateBlocklist()); lists.addView(updateButton,lpH(48));
        updateText=tv("",12,muted,false); lists.addView(updateText); space(lists,7);
        Button resetCache=button("AWARYJNY RESET CACHE / PRO",surface2,text); resetCache.setOnClickListener(v->confirmResetCache()); lists.addView(resetCache,lpH(48));
        space(root,10);

        LinearLayout blocks=card(surface,20); root.addView(blocks,lpWrap()); blocks.addView(tv("KONSOLA BLOKAD",16,text,true));
        blocks.addView(tv("DNS: aplikacja/UID, pakiet, domena i powód. Smart Engine zapisuje osobne wpisy SMART/AD_DETECTED/ACTION/AUDIO w SYSTEM CONSOLE.",12,muted,false)); space(blocks,6);
        blockInfo=tv("",12,muted,false); blocks.addView(blockInfo); blockBox=new LinearLayout(this); blockBox.setOrientation(LinearLayout.VERTICAL); blocks.addView(blockBox,lpWrap()); space(blocks,8);
        Button refreshBlocks=button("ODŚWIEŻ BLOKADY",surface2,text); refreshBlocks.setOnClickListener(v->{renderBlockedLogs();refreshSmartStatus();}); blocks.addView(refreshBlocks,lpH(44)); space(blocks,6);
        Button fullConsole=button("SYSTEM CONSOLE • SMART / BŁĘDY / DIAGNOSTYKA",blue,Color.BLACK); fullConsole.setOnClickListener(v->startActivity(new Intent(this,SystemConsoleActivity.class))); blocks.addView(fullConsole,lpH(50));
        space(root,10);

        LinearLayout custom=card(surface,20); root.addView(custom,lpWrap()); custom.addView(tv("WŁASNA DOMENA",16,text,true));
        domainInput=new EditText(this); domainInput.setTextColor(text); domainInput.setHintTextColor(muted); domainInput.setHint("ads.example.com"); domainInput.setSingleLine(true); domainInput.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); domainInput.setBackground(round(surface2,12)); domainInput.setPadding(dp(12),0,dp(12),0); custom.addView(domainInput,lpH(48)); space(custom,7);
        LinearLayout rr=new LinearLayout(this); custom.addView(rr,lpWrap()); Button block=button("BLOKUJ",red,Color.WHITE),allow=button("ZEZWÓL",green,Color.BLACK);
        LinearLayout.LayoutParams r1=new LinearLayout.LayoutParams(0,dp(46),1); r1.setMarginEnd(dp(5)); LinearLayout.LayoutParams r2=new LinearLayout.LayoutParams(0,dp(46),1); r2.setMarginStart(dp(5)); rr.addView(block,r1); rr.addView(allow,r2);
        block.setOnClickListener(v->addRule(true)); allow.setOnClickListener(v->addRule(false)); space(root,10);

        LinearLayout settings=card(surface,20); root.addView(settings,lpWrap()); settings.addView(tv("USTAWIENIA",16,text,true));
        Switch auto=new Switch(this); auto.setText("Uruchamiaj DNS/VPN po restarcie telefonu"); auto.setTextColor(text); auto.setChecked(prefs.getBoolean(BlocklistManager.KEY_AUTOSTART,true)); auto.setOnCheckedChangeListener((x,on)->prefs.edit().putBoolean(BlocklistManager.KEY_AUTOSTART,on).apply()); settings.addView(auto,lpWrap());
        space(root,10);

        Button github=button("GITHUB • github.com/Swir/xADKiller",surface2,text); github.setOnClickListener(v->openUrl("https://github.com/Swir/xADKiller")); root.addView(github,lpH(50));
        space(root,10);
        TextView footer=tv("xADKiller 1.3.0 • DNS + Smart Ad Engine • No root • BY SWIR",11,muted,false); footer.setGravity(Gravity.CENTER); root.addView(footer,lpWrap());
        setContentView(scroll);
    }

    private void refreshSmartStatus() {
        if (smartStatusText == null || smartStatsText == null) return;
        SharedPreferences p=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        boolean enabled=isSmartServiceEnabled();
        boolean engine=p.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED,true);
        long hb=p.getLong(SmartAdAccessibilityService.KEY_HEARTBEAT,0);
        boolean live=enabled && hb>0 && System.currentTimeMillis()-hb<15000;
        if(!enabled){
            smartStatusText.setText("⚠ USŁUGA WYŁĄCZONA • włącz xADKiller Smart Ad Engine w Ułatwieniach dostępu");
            smartStatusText.setTextColor(getColor(R.color.swir_red));
        }else if(!engine){
            smartStatusText.setText("Usługa włączona • Smart detection wyłączone w xADKiller");
            smartStatusText.setTextColor(getColor(R.color.swir_muted));
        }else if(live){
            smartStatusText.setText("AKTYWNY • lokalne wykrywanie UI działa w tle");
            smartStatusText.setTextColor(getColor(R.color.swir_green));
        }else{
            smartStatusText.setText("WŁĄCZONY • oczekiwanie na pierwsze zdarzenie aplikacji");
            smartStatusText.setTextColor(getColor(R.color.swir_blue));
        }
        long d=p.getLong(SmartAdAccessibilityService.KEY_DETECTIONS,0), a=p.getLong(SmartAdAccessibilityService.KEY_ACTIONS,0);
        String last=p.getString(SmartAdAccessibilityService.KEY_LAST_APP,"");
        smartStatsText.setText(d+" wykryć • "+a+" akcji"+(last.isEmpty()?"":" • ostatnio: "+last));
    }

    private boolean isSmartServiceEnabled() {
        try {
            AccessibilityManager am=(AccessibilityManager)getSystemService(ACCESSIBILITY_SERVICE);
            if(am==null || !am.isEnabled())return false;
            List<AccessibilityServiceInfo> list=am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            for(AccessibilityServiceInfo info:list){
                if(info==null || info.getResolveInfo()==null || info.getResolveInfo().serviceInfo==null)continue;
                ServiceInfo si=info.getResolveInfo().serviceInfo;
                if(getPackageName().equals(si.packageName) && si.name!=null && si.name.endsWith("SmartAdAccessibilityService"))return true;
            }
        }catch(Throwable t){SystemLogStore.error(this,"SMART","Nie udało się odczytać stanu AccessibilityService",t);}
        return false;
    }

    private void openAccessibilitySettings(){
        try{startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));Toast.makeText(this,"Znajdź „xADKiller Smart Ad Engine” i włącz usługę.",Toast.LENGTH_LONG).show();}
        catch(Exception e){SystemLogStore.error(this,"SMART","Nie udało się otworzyć ustawień Accessibility",e);}
    }

    private void toggleProtection() {
        running = hasFreshHeartbeat();
        if (running) {
            SystemLogStore.info(this,"UI","Użytkownik wyłączył ochronę");
            try { startService(new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_STOP)); }
            catch(Exception e){ SystemLogStore.error(this,"VPN","STOP nieudany",e); }
            return;
        }
        PrivateDnsHelper.Snapshot s=PrivateDnsHelper.inspect(this);
        if(s.isStrict()){
            SystemLogStore.warn(this,"PRIVATE_DNS","Wykryto STRICT: "+s.pretty());
            new AlertDialog.Builder(this).setTitle("Konflikt z Prywatnym DNS").setMessage("Prywatny DNS jest ustawiony na konkretną nazwę hosta ("+s.pretty()+"). To może kolidować z lokalnym filtrem xADKiller.\n\nNajlepiej ustaw AUTOMATYCZNY albo WYŁĄCZONY.").setNegativeButton("Anuluj",null).setPositiveButton("Ustawienia",(d,w)->openPrivateDnsSettings()).setNeutralButton("Uruchom mimo to",(d,w)->prepareVpn()).show();
            return;
        }
        prepareVpn();
    }

    private void prepareVpn() {
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},REQ_NOTIFICATIONS);
        SystemLogStore.info(this,"VPN","Żądanie uruchomienia ochrony"); Intent p=VpnService.prepare(this); if(p!=null)startActivityForResult(p,REQ_VPN);else startShieldService();
    }

    @Override protected void onActivityResult(int r,int result,Intent data) {
        super.onActivityResult(r,result,data);
        if(r==REQ_VPN){if(result==RESULT_OK)startShieldService();else SystemLogStore.warn(this,"VPN","Użytkownik nie zaakceptował zgody VPN");}
    }

    private void startShieldService() {
        try {
            Intent i=new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_START);
            if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);
            statusText.setText("URUCHAMIANIE…");statusText.setTextColor(getColor(R.color.swir_blue));
        } catch(Exception e) {SystemLogStore.error(this,"VPN","Start serwisu nieudany",e);Toast.makeText(this,"Błąd startu — zobacz SYSTEM CONSOLE.",Toast.LENGTH_LONG).show();}
    }

    private void renderStatus(long q,long b,int d,String last) {
        if(statusText==null)return;
        if(running){statusText.setText("AKTYWNA");statusText.setTextColor(getColor(R.color.swir_green));mainButton.setText("WYŁĄCZ OCHRONĘ");mainButton.setBackground(round(getColor(R.color.swir_red),14));mainButton.setTextColor(Color.WHITE);}
        else{statusText.setText("WYŁĄCZONA");statusText.setTextColor(getColor(R.color.swir_red));mainButton.setText("WŁĄCZ OCHRONĘ");mainButton.setBackground(round(getColor(R.color.swir_blue),14));mainButton.setTextColor(Color.BLACK);}
        statsText.setText(b+" zablokowanych • "+q+" zapytań");domainsText.setText(d+" domen na liście");lastBlockedText.setText("Ostatnia blokada: "+(last==null?"—":last));
    }

    private void renderPrivateDns() {
        if(privateDnsText==null)return; PrivateDnsHelper.Snapshot s=PrivateDnsHelper.inspect(this);
        if(s.isStrict()){privateDnsText.setText("⚠ STRICT: "+s.pretty()+"\nMoże kolidować z filtrem xADKiller.");privateDnsText.setTextColor(getColor(R.color.swir_red));}
        else{privateDnsText.setText("OK • "+s.pretty()+" • DNS: "+s.dnsServers);privateDnsText.setTextColor(getColor(R.color.swir_green));}
    }

    private void renderBlockedLogs() {
        if(blockBox==null)return; blockBox.removeAllViews(); List<LogStore.Entry> logs=LogStore.readRecent(this,12); blockInfo.setText(logs.size()+" ostatnich blokad");
        if(logs.isEmpty()){blockBox.addView(tv("Brak wpisów. Po włączeniu ochrony blokady pojawią się tutaj.",13,getColor(R.color.swir_muted),false));return;}
        DateFormat tf=DateFormat.getTimeInstance(DateFormat.MEDIUM,Locale.getDefault());
        for(LogStore.Entry e:logs){
            LinearLayout row=card(getColor(R.color.swir_surface_2),12);LinearLayout.LayoutParams p=lpWrap();p.setMargins(0,0,0,dp(6));blockBox.addView(row,p);
            row.addView(tv(tf.format(new Date(e.time))+" • "+e.reason,10,getColor(R.color.swir_muted),false));row.addView(tv(e.appName+(e.uid>=0?" [UID "+e.uid+"]":""),13,getColor(R.color.swir_text),true));
            if(!e.packageName.isEmpty()){TextView pkg=tv(e.packageName+" ↗",11,getColor(R.color.swir_blue),false);pkg.setOnClickListener(v->openApp(e.packageName));row.addView(pkg);}
            TextView dom=tv(e.domain+" ↗",12,getColor(R.color.swir_cyan),true);dom.setOnClickListener(v->confirmDomain(e.domain));row.addView(dom);
        }
    }

    private void updateBlocklist() {
        if(updateButton==null || !updateButton.isEnabled())return;
        updateButton.setEnabled(false);updateButton.setText("POBIERANIE…");updateText.setText("Aktualizacja w tle — aplikacja pozostaje responsywna.");SystemLogStore.info(this,"BLOCKLIST","Ręczna aktualizacja rozpoczęta");
        new Thread(()->{try{int n=BlocklistManager.updateRemote(getApplicationContext());SystemLogStore.info(this,"BLOCKLIST","Aktualizacja OK • "+n+" domen");runOnUiThread(()->{updateButton.setEnabled(true);updateButton.setText("AKTUALIZUJ LISTY");updateText.setText("Gotowe • "+n+" domen");domainsText.setText(n+" domen na liście");renderLastUpdate();reloadService();});}catch(Throwable e){SystemLogStore.error(this,"BLOCKLIST","Aktualizacja nieudana",e);runOnUiThread(()->{updateButton.setEnabled(true);updateButton.setText("AKTUALIZUJ LISTY");updateText.setText("Błąd — zobacz SYSTEM CONSOLE");});}},"xADKiller-List-Updater").start();
    }

    private void confirmResetCache() {
        new AlertDialog.Builder(this).setTitle("Awaryjny reset list?").setMessage("Usunie pobraną dużą listę i wyłączy PRO. Własne reguły zostaną zachowane.").setNegativeButton("Anuluj",null).setPositiveButton("RESET",(d,w)->{try{startService(new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_STOP));}catch(Exception ignored){}BlocklistManager.clearRemoteCache(this);running=false;SystemLogStore.warn(this,"RECOVERY","Użytkownik wykonał awaryjny reset cache/PRO");renderStatus(0,0,BlocklistManager.currentCount(),"—");renderLastUpdate();if(engineText!=null)engineText.setText("DNS: cache wyczyszczony • lista startowa aktywna");Toast.makeText(this,"Cache zresetowany.",Toast.LENGTH_LONG).show();}).show();
    }

    private void renderLastUpdate(){long t=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE).getLong(BlocklistManager.KEY_LAST_UPDATE,0);updateText.setText(t<=0?"Wbudowana lista startowa.":"Ostatnia aktualizacja: "+DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT,Locale.getDefault()).format(new Date(t)));}
    private void reloadService(){if(!hasFreshHeartbeat())return;try{startService(new Intent(this,AdBlockVpnServiceV121.class).setAction(AdBlockVpnServiceV121.ACTION_RELOAD));}catch(Exception e){SystemLogStore.error(this,"VPN","Przeładowanie list w serwisie nieudane",e);}}
    private void addRule(boolean block){String n=BlocklistManager.normalize(domainInput.getText().toString());if(n==null){Toast.makeText(this,"Podaj poprawną domenę.",Toast.LENGTH_LONG).show();return;}if(block)BlocklistManager.addCustomBlock(this,n);else BlocklistManager.addAllow(this,n);domainInput.setText("");domainsText.setText(BlocklistManager.currentCount()+" domen na liście");SystemLogStore.info(this,"RULE",(block?"BLOCK ":"ALLOW ")+n);reloadService();Toast.makeText(this,block?"Dodano blokadę.":"Dodano wyjątek.",Toast.LENGTH_SHORT).show();}

    private void openPrivateDnsSettings(){try{startActivity(PrivateDnsHelper.settingsIntent());}catch(Exception e){SystemLogStore.error(this,"UI","Nie udało się otworzyć ustawień DNS",e);}}
    private void confirmDomain(String d){new AlertDialog.Builder(this).setTitle("Otworzyć zablokowaną domenę?").setMessage(d+" została zablokowana. Otwieraj tylko, jeśli wiesz co robisz.").setNegativeButton("Anuluj",null).setPositiveButton("Otwórz",(x,w)->openUrl("https://"+d)).show();}
    private void openApp(String p){try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("market://details?id="+p)));}catch(Exception e){openUrl("https://play.google.com/store/apps/details?id="+p);}}
    private void openUrl(String u){try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(u)));}catch(Exception e){Toast.makeText(this,"Nie można otworzyć linku.",Toast.LENGTH_SHORT).show();}}

    private void showEmergencyUi(Throwable cause) {
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(24),dp(40),dp(24),dp(24));root.setBackgroundColor(getColor(R.color.swir_bg));
        root.addView(tv("xADKILLER • SAFE MODE",25,getColor(R.color.swir_red),true));root.addView(tv("Ekran główny napotkał błąd, ale aplikacja uruchomiła tryb awaryjny zamiast zamknąć się w pętli.",14,getColor(R.color.swir_text),false));space(root,12);
        TextView err=tv(cause.getClass().getSimpleName()+": "+cause.getMessage(),12,getColor(R.color.swir_muted),false);err.setTextIsSelectable(true);root.addView(err);space(root,12);
        Button reset=button("RESET CACHE I PRO",getColor(R.color.swir_red),Color.WHITE);reset.setOnClickListener(v->{BlocklistManager.clearRemoteCache(this);recreate();});root.addView(reset,lpH(50));space(root,8);
        Button smart=button("USTAWIENIA SMART ENGINE",getColor(R.color.swir_blue),Color.BLACK);smart.setOnClickListener(v->openAccessibilitySettings());root.addView(smart,lpH(50));space(root,8);
        Button console=button("OTWÓRZ SYSTEM CONSOLE",getColor(R.color.swir_blue),Color.BLACK);console.setOnClickListener(v->startActivity(new Intent(this,SystemConsoleActivity.class)));root.addView(console,lpH(50));setContentView(root);
    }

    private TextView label(String s,int color){TextView v=tv(s,11,color,true);v.setLetterSpacing(.1f);return v;}
    private TextView tv(String s,float sp,int c,boolean bold){TextView v=new TextView(this);v.setText(s);v.setTextSize(sp);v.setTextColor(c);v.setLineSpacing(0,1.08f);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;}
    private Button button(String t,int bg,int fg){Button b=new Button(this);b.setText(t);b.setTextColor(fg);b.setTextSize(12);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setAllCaps(false);b.setPadding(dp(8),0,dp(8),0);b.setBackground(round(bg,13));return b;}
    private LinearLayout card(int bg,int r){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(15),dp(13),dp(15),dp(13));c.setBackground(round(bg,r));return c;}
    private GradientDrawable round(int c,int r){GradientDrawable d=new GradientDrawable();d.setColor(c);d.setCornerRadius(dp(r));return d;}
    private LinearLayout.LayoutParams lpWrap(){return new LinearLayout.LayoutParams(-1,-2);} private LinearLayout.LayoutParams lpH(int h){return new LinearLayout.LayoutParams(-1,dp(h));} private void space(LinearLayout p,int d){Space s=new Space(this);p.addView(s,new LinearLayout.LayoutParams(1,dp(d)));} private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}
