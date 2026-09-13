package com.swir.xadkiller;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;

public class AdaptiveAiActivity extends Activity {
    private TextView modelStats, lastObservation, communityStats, statusText;
    private Button updateCommunity;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        AdaptiveLearningEngine.load(this);
        CommunityLearningManager.load(this);
        buildUi();
        refresh();
    }

    @Override protected void onResume(){super.onResume();refresh();}

    private void buildUi(){
        int bg=getColor(R.color.swir_bg), surface=getColor(R.color.swir_surface), surface2=getColor(R.color.swir_surface_2), blue=getColor(R.color.swir_blue), green=getColor(R.color.swir_green), text=getColor(R.color.swir_text), muted=getColor(R.color.swir_muted), red=getColor(R.color.swir_red);
        ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(bg);scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(18),dp(18),dp(18),dp(30));scroll.addView(root,new ScrollView.LayoutParams(-1,-2));

        TextView title=tv("ADAPTIVE AI LAB",27,text,true);title.setLetterSpacing(.07f);root.addView(title);
        root.addView(tv("xADKiller v1.4.1 • Local + Community + Benchmark Learning",12,blue,true));space(root,12);

        LinearLayout intro=card(surface,18);root.addView(intro,lpWrap());
        intro.addView(tv("JAK TO DZIAŁA",15,text,true));
        intro.addView(tv("Model uczy się na telefonie. Zapamiętuje zahashowane cechy interfejsu, nie pełny tekst ekranu. Community/Benchmark AI pobiera publiczne reguły i strony testowe, wyciąga tylko krótkie sygnały reklamowe i nigdy nie wykonuje ich kodu JavaScript.",12,muted,false));
        space(intro,8);statusText=tv("",13,green,true);intro.addView(statusText);space(root,10);

        SharedPreferences prefs=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        LinearLayout controls=card(surface,18);root.addView(controls,lpWrap());controls.addView(tv("TRYB UCZENIA",15,text,true));
        Switch enabled=new Switch(this);enabled.setText("Adaptive AI aktywne");enabled.setTextColor(text);enabled.setChecked(prefs.getBoolean(AdaptiveLearningEngine.KEY_ENABLED,true));
        enabled.setOnCheckedChangeListener((x,on)->{prefs.edit().putBoolean(AdaptiveLearningEngine.KEY_ENABLED,on).apply();SystemLogStore.info(this,"AI_MODEL","Adaptive AI: "+on);refresh();});controls.addView(enabled,lpWrap());
        Switch auto=new Switch(this);auto.setText("Ucz się lekko po udanym Auto-Skip");auto.setTextColor(text);auto.setChecked(prefs.getBoolean(AdaptiveLearningEngine.KEY_AUTO_LEARN,true));
        auto.setOnCheckedChangeListener((x,on)->{prefs.edit().putBoolean(AdaptiveLearningEngine.KEY_AUTO_LEARN,on).apply();SystemLogStore.info(this,"AI_MODEL","Auto-learning po Skip-Ad: "+on);});controls.addView(auto,lpWrap());
        space(controls,7);
        Button access=button("USTAWIENIA SMART ENGINE",surface2,text);access.setOnClickListener(v->{try{startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));}catch(Exception e){SystemLogStore.error(this,"AI_UI","Nie udało się otworzyć Accessibility",e);}});controls.addView(access,lpH(48));space(root,10);

        LinearLayout model=card(surface,18);root.addView(model,lpWrap());model.addView(tv("MODEL LOKALNY",15,text,true));
        modelStats=tv("",13,text,false);model.addView(modelStats);space(model,5);lastObservation=tv("",12,muted,false);model.addView(lastObservation);space(model,10);
        LinearLayout feedback=new LinearLayout(this);feedback.setOrientation(LinearLayout.HORIZONTAL);model.addView(feedback,lpWrap());
        Button yes=button("✓ TO BYŁA REKLAMA",green,Color.BLACK), no=button("✕ FAŁSZYWY ALARM",red,Color.WHITE);
        LinearLayout.LayoutParams p1=new LinearLayout.LayoutParams(0,dp(50),1);p1.setMarginEnd(dp(5));LinearLayout.LayoutParams p2=new LinearLayout.LayoutParams(0,dp(50),1);p2.setMarginStart(dp(5));feedback.addView(yes,p1);feedback.addView(no,p2);
        yes.setOnClickListener(v->feedback(true));no.setOnClickListener(v->feedback(false));
        model.addView(tv("Naciśnij odpowiedni przycisk zaraz po powrocie z testowanej aplikacji. xADKiller uczy wtedy ostatni ekran widziany przez Smart Engine.",11,muted,false));
        space(model,8);
        Button reset=button("RESETUJ LOKALNE UCZENIE",surface2,text);reset.setOnClickListener(v->confirmReset());model.addView(reset,lpH(46));space(root,10);

        LinearLayout community=card(surface,18);root.addView(community,lpWrap());community.addView(tv("COMMUNITY + BENCHMARK INTELLIGENCE",15,text,true));
        community.addView(tv("Źródła: EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com i SuperAdBlockTest.com. Pobieramy tylko publiczny tekst/reguły i wyciągamy z nich identyfikatory reklamowe. Same strony testowe nigdy nie są automatycznie blokowane.",12,muted,false));
        space(community,6);communityStats=tv("",12,muted,false);community.addView(communityStats);space(community,8);
        updateCommunity=button("AKTUALIZUJ COMMUNITY + BENCHMARK AI",blue,Color.BLACK);updateCommunity.setOnClickListener(v->updateCommunity());community.addView(updateCommunity,lpH(50));space(root,10);

        LinearLayout benchmark=card(surface,18);root.addView(benchmark,lpWrap());benchmark.addView(tv("BENCHMARK LAB • 3 TESTY",15,text,true));
        benchmark.addView(tv("Uruchom test w przeglądarce przy aktywnym VPN/DNS i Smart Engine. Wynik traktujemy jako diagnostykę — nie uczymy modelu na ślepo tylko po to, żeby nabić procent.",12,muted,false));space(benchmark,8);
        Button t1=button("1 • TURTLECUTE AD BLOCK TEST",surface2,text);t1.setOnClickListener(v->openUrl("https://adblock.turtlecute.org/"));benchmark.addView(t1,lpH(46));space(benchmark,6);
        Button t2=button("2 • ADBLOCK-TESTER.COM",surface2,text);t2.setOnClickListener(v->openUrl("https://adblock-tester.com/"));benchmark.addView(t2,lpH(46));space(benchmark,6);
        Button t3=button("3 • SUPER ADBLOCK TEST",surface2,text);t3.setOnClickListener(v->openUrl("https://superadblocktest.com/"));benchmark.addView(t3,lpH(46));space(benchmark,8);
        Button learn=button("UCZ Z TYCH ŹRÓDEŁ TERAZ",blue,Color.BLACK);learn.setOnClickListener(v->updateCommunity());benchmark.addView(learn,lpH(50));space(root,10);

        LinearLayout tips=card(surface,18);root.addView(tips,lpWrap());tips.addView(tv("JAK NAJSZYBCIEJ UCZYĆ",15,text,true));
        tips.addView(tv("1. Zaktualizuj Community + Benchmark AI.\n2. Uruchom jeden z trzech testów albo zwykłą aplikację z reklamą.\n3. Jeśli reklama przejdzie, wróć do xADKiller i użyj „To była reklama”.\n4. Przy pomyłce użyj „Fałszywy alarm”.\n\nW ten sposób benchmarki dostarczają wiedzę, ale lokalny feedback nadal ma najwyższe znaczenie.",12,muted,false));space(root,10);

        Button back=button("← WRÓĆ DO xADKILLER",surface2,text);back.setOnClickListener(v->finish());root.addView(back,lpH(50));space(root,8);
        TextView footer=tv("Adaptive AI • Benchmark Learning • on-device • BY SWIR",11,muted,false);footer.setGravity(Gravity.CENTER);root.addView(footer,lpWrap());
        setContentView(scroll);
    }

    private void feedback(boolean wasAd){
        AdaptiveLearningEngine.FeedbackResult r=AdaptiveLearningEngine.trainLastFeedback(this,wasAd);
        Toast.makeText(this,r.message,Toast.LENGTH_LONG).show();
        refresh();
    }

    private void updateCommunity(){
        if(updateCommunity!=null){updateCommunity.setEnabled(false);updateCommunity.setText("UCZENIE Z 6 ŹRÓDEŁ…");}
        SystemLogStore.info(this,"AI_COMMUNITY","Ręczna aktualizacja Community/Benchmark AI rozpoczęta");
        new Thread(()->{
            try{
                int n=CommunityLearningManager.update(getApplicationContext());
                runOnUiThread(()->{if(updateCommunity!=null){updateCommunity.setEnabled(true);updateCommunity.setText("AKTUALIZUJ COMMUNITY + BENCHMARK AI");}Toast.makeText(this,"AI: "+n+" sygnałów.",Toast.LENGTH_LONG).show();refresh();});
            }catch(Throwable t){
                SystemLogStore.error(this,"AI_COMMUNITY","Ręczna aktualizacja nieudana",t);
                runOnUiThread(()->{if(updateCommunity!=null){updateCommunity.setEnabled(true);updateCommunity.setText("AKTUALIZUJ COMMUNITY + BENCHMARK AI");}Toast.makeText(this,"Błąd aktualizacji — zobacz SYSTEM CONSOLE.",Toast.LENGTH_LONG).show();refresh();});
            }
        },"xADKiller-BenchmarkUpdate").start();
    }

    private void openUrl(String url){
        try{startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));}
        catch(Exception e){SystemLogStore.error(this,"AI_UI","Nie udało się otworzyć testu",e);Toast.makeText(this,"Nie można otworzyć strony testowej.",Toast.LENGTH_LONG).show();}
    }

    private void confirmReset(){
        new AlertDialog.Builder(this).setTitle("Zresetować Adaptive AI?").setMessage("Usunie tylko lokalnie nauczone wagi i feedback. Listy DNS i Community/Benchmark AI zostaną zachowane.").setNegativeButton("Anuluj",null).setPositiveButton("RESET",(d,w)->{AdaptiveLearningEngine.reset(this);refresh();Toast.makeText(this,"Model lokalny zresetowany.",Toast.LENGTH_LONG).show();}).show();
    }

    private void refresh(){
        AdaptiveLearningEngine.Stats s=AdaptiveLearningEngine.stats(this);
        SharedPreferences p=getSharedPreferences(BlocklistManager.PREFS,MODE_PRIVATE);
        boolean enabled=p.getBoolean(AdaptiveLearningEngine.KEY_ENABLED,true);
        statusText.setText(enabled?"● ADAPTIVE AI AKTYWNE":"○ ADAPTIVE AI WYŁĄCZONE");statusText.setTextColor(enabled?getColor(R.color.swir_green):getColor(R.color.swir_muted));
        modelStats.setText("Próbki feedbacku: "+s.samples+" • reklamy: "+s.positive+" • false-positive: "+s.negative+"\nAktywne nauczone cechy: "+s.modelFeatures);
        if(s.lastObservationTime>0){
            String dt=DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.MEDIUM,Locale.getDefault()).format(new Date(s.lastObservationTime));
            lastObservation.setText("Ostatnia obserwacja: "+(s.lastPackage.isEmpty()?"nieznana aplikacja":s.lastPackage)+" • base score="+s.lastBaseScore+" • "+dt);
        }else lastObservation.setText("Ostatnia obserwacja: brak — użyj aplikacji przy włączonym Smart Engine.");
        int count=CommunityLearningManager.count(this);long last=p.getLong(CommunityLearningManager.KEY_LAST_UPDATE,0);int ok=p.getInt(CommunityLearningManager.KEY_SOURCES_OK,0);int total=p.getInt(CommunityLearningManager.KEY_SOURCES_TOTAL,CommunityLearningManager.sourceCount());
        communityStats.setText("Sygnały AI: "+count+" • źródła: "+(last>0?ok+"/"+total:"seed / "+total)+(last>0?" • aktualizacja: "+DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT,Locale.getDefault()).format(new Date(last)):""));
    }

    private TextView tv(String s,float sp,int c,boolean bold){TextView v=new TextView(this);v.setText(s);v.setTextSize(sp);v.setTextColor(c);v.setLineSpacing(0,1.08f);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;}
    private Button button(String t,int bg,int fg){Button b=new Button(this);b.setText(t);b.setTextColor(fg);b.setTextSize(12);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setAllCaps(false);b.setPadding(dp(8),0,dp(8),0);b.setBackground(round(bg,13));return b;}
    private LinearLayout card(int bg,int r){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(15),dp(13),dp(15),dp(13));c.setBackground(round(bg,r));return c;}
    private GradientDrawable round(int c,int r){GradientDrawable d=new GradientDrawable();d.setColor(c);d.setCornerRadius(dp(r));return d;}
    private LinearLayout.LayoutParams lpWrap(){return new LinearLayout.LayoutParams(-1,-2);}private LinearLayout.LayoutParams lpH(int h){return new LinearLayout.LayoutParams(-1,dp(h));}private void space(LinearLayout p,int d){Space s=new Space(this);p.addView(s,new LinearLayout.LayoutParams(1,dp(d)));}private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}
