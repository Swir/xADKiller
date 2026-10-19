package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SmartEngineAccessGuideTest {
    @Test public void android13DisabledServiceOffersRestrictedSettingsHelp() {
        assertTrue(SmartEngineAccessGuide.shouldOfferRestrictedSettingsHelp(33, false));
    }

    @Test public void preAndroid13DisabledServiceOpensAccessibilityDirectly() {
        assertFalse(SmartEngineAccessGuide.shouldOfferRestrictedSettingsHelp(32, false));
    }

    @Test public void enabledServiceNeverShowsRestrictedSettingsHelp() {
        assertFalse(SmartEngineAccessGuide.shouldOfferRestrictedSettingsHelp(35, true));
    }
}
