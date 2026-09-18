package com.swir.xadkiller;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import org.junit.Test;

public class BlocklistTransportSecurityTest {
    @Test public void acceptsOnlyKnownHttpsFeedInfrastructure() {
        assertTrue(BlocklistManager.isAllowedRemoteUrl(
                "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"));
        assertTrue(BlocklistManager.isAllowedRemoteUrl(
                "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt"));
        assertTrue(BlocklistManager.isAllowedRemoteUrl("https://adaway.org/hosts.txt"));
        assertTrue(BlocklistManager.isAllowedRemoteUrl("https://edge.jsdelivr.net/path/list.txt"));
    }

    @Test public void rejectsDowngradesCredentialsLookalikesAndCustomPorts() {
        assertFalse(BlocklistManager.isAllowedRemoteUrl(
                "http://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"));
        assertFalse(BlocklistManager.isAllowedRemoteUrl(
                "https://user@raw.githubusercontent.com/StevenBlack/hosts/master/hosts"));
        assertFalse(BlocklistManager.isAllowedRemoteUrl(
                "https://raw.githubusercontent.com.evil.example/hosts"));
        assertFalse(BlocklistManager.isAllowedRemoteUrl("https://evil.example/hosts.txt"));
        assertFalse(BlocklistManager.isAllowedRemoteUrl("https://cdn.jsdelivr.net:8443/feed.txt"));
        assertFalse(BlocklistManager.isAllowedRemoteUrl("not a url"));
    }

    @Test public void acceptsPlainTextFeedMimeAndRejectsExecutableOrErrorDocuments() {
        assertTrue(BlocklistManager.isAllowedRemoteContentType("text/plain"));
        assertTrue(BlocklistManager.isAllowedRemoteContentType("Text/Plain; charset=utf-8"));
        assertTrue(BlocklistManager.isAllowedRemoteContentType("application/octet-stream"));
        // Preserve compatibility with trusted raw/CDN endpoints that omit the header.
        assertTrue(BlocklistManager.isAllowedRemoteContentType(null));
        assertTrue(BlocklistManager.isAllowedRemoteContentType("   "));

        assertFalse(BlocklistManager.isAllowedRemoteContentType("text/html"));
        assertFalse(BlocklistManager.isAllowedRemoteContentType("application/json"));
        assertFalse(BlocklistManager.isAllowedRemoteContentType("application/javascript"));
        assertFalse(BlocklistManager.isAllowedRemoteContentType("text/css"));
    }

    @Test public void acceptsIdentityTransferAndRejectsUnexpectedCompression() {
        assertTrue(BlocklistManager.isAllowedRemoteContentEncoding(null));
        assertTrue(BlocklistManager.isAllowedRemoteContentEncoding(""));
        assertTrue(BlocklistManager.isAllowedRemoteContentEncoding("identity"));
        assertTrue(BlocklistManager.isAllowedRemoteContentEncoding(" IDENTITY "));
        assertFalse(BlocklistManager.isAllowedRemoteContentEncoding("gzip"));
        assertFalse(BlocklistManager.isAllowedRemoteContentEncoding("br"));
        assertFalse(BlocklistManager.isAllowedRemoteContentEncoding("deflate"));
    }

    @Test public void boundedRemoteInputAllowsPayloadAtExactLimit() throws Exception {
        byte[] payload = "abcd".getBytes(StandardCharsets.UTF_8);
        try (InputStream input = BlocklistManager.boundedRemoteInput(
                new ByteArrayInputStream(payload), payload.length)) {
            assertArrayEquals(payload, input.readAllBytes());
        }
    }

    @Test public void boundedRemoteInputRejectsChunkedOverflow() {
        byte[] payload = "abcde".getBytes(StandardCharsets.UTF_8);
        assertThrows(IOException.class, () -> {
            try (InputStream input = BlocklistManager.boundedRemoteInput(
                    new ByteArrayInputStream(payload), 4)) {
                input.readAllBytes();
            }
        });
    }
}
