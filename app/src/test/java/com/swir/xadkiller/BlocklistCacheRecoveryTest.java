package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.Test;

public class BlocklistCacheRecoveryTest {
    private static void write(File file, String value) throws Exception {
        Files.write(file.toPath(), value.getBytes(StandardCharsets.UTF_8));
    }

    private static String read(File file) throws Exception {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private static String healthyList(String prefix) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 1_050; i++) {
            out.append(prefix).append(i).append(".example.net\n");
        }
        return out.toString();
    }

    @Test public void recoverySemanticScanIsBoundedForColdStart() {
        assertEquals(10_000, BlocklistCacheRecovery.MAX_RECOVERY_SCAN_DOMAINS);
    }

    @Test public void normalStartupWithoutRollbackSkipsRecoveryAndCleansTemporaryFile() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-normal-start").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        String current = healthyList("current");
        write(primary, current);
        write(temporary, healthyList("interrupted"));

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertEquals(current, read(primary));
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void restoresSemanticallyHealthyBackupWhenPrimaryIsMissing() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-recovery").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        String knownGood = healthyList("ads");
        write(backup, knownGood);
        write(temporary, "unverified.example\n");

        assertTrue(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertTrue(primary.isFile());
        assertEquals(knownGood, read(primary));
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void restoresHealthyBackupOverNonEmptyCorruptPrimary() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-corrupt-primary").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        String knownGood = healthyList("tracker");
        write(primary, "<html>upstream error</html>\n");
        write(backup, knownGood);
        write(temporary, "candidate-not-yet-validated.example\n");

        assertTrue(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertEquals(knownGood, read(primary));
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void keepsSemanticallyHealthyPrimaryAndRemovesStaleRollbackFiles() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-primary").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        String current = healthyList("new");
        write(primary, current);
        write(backup, healthyList("old"));
        write(temporary, "interrupted-next-update.example\n");

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertEquals(current, read(primary));
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void neverPromotesTemporaryCandidateWithoutKnownGoodBackup() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-temp").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(temporary, healthyList("candidate"));

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertFalse(primary.exists());
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void nonEmptyButTinyBackupCannotBecomeProtectionData() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-tiny").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(backup, "ads.example\ntracker.example\n");

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertFalse(primary.exists());
        assertFalse(backup.exists());
    }

    @Test public void duplicateInflatedBackupCannotSatisfyRecoveryThreshold() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-duplicates").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        StringBuilder duplicate = new StringBuilder();
        for (int i = 0; i < 2_500; i++) duplicate.append("same.example.net\n");
        write(backup, duplicate.toString());

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertFalse(primary.exists());
        assertFalse(backup.exists());
    }

    @Test public void emptyBackupCannotBecomeProtectionData() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-empty").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(backup, "");

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertFalse(primary.exists());
        assertFalse(backup.exists());
    }
}
