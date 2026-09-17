package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import org.junit.Test;

public class DnsResponseValidationTest {
    @Test public void acceptsMatchingStandardResponse() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        assertTrue(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsTransactionIdMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1235, 0x8180, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQueryShapedPacketFromUpstream() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsDnsResponseMarkedTruncated() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8380, 1, 1); // QR + TC + RD + RA
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQuestionNameMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("safe.example.com", 0x1234, 0x8180, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQuestionTypeMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 28, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQuestionClassMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 3);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsTruncatedResponseLength() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, 16));
    }

    @Test public void acceptsValidResponseInsideLargerReceiveBuffer() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        byte[] receiveBuffer = Arrays.copyOf(response, response.length + 256);
        assertTrue(DnsPacket.isValidUpstreamResponse(query, receiveBuffer, response.length));
    }

    private static byte[] dns(String host, int id, int flags, int qtype, int qclass) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write16(out, id);
        write16(out, flags);
        write16(out, 1);
        write16(out, 0);
        write16(out, 0);
        write16(out, 0);
        for (String label : host.split("\\.")) label(out, label);
        out.write(0);
        write16(out, qtype);
        write16(out, qclass);
        return out.toByteArray();
    }

    private static void label(ByteArrayOutputStream out, String label) {
        byte[] bytes = label.getBytes(StandardCharsets.US_ASCII);
        out.write(bytes.length);
        out.write(bytes, 0, bytes.length);
    }

    private static void write16(ByteArrayOutputStream out, int value) {
        out.write((value >>> 8) & 0xFF);
        out.write(value & 0xFF);
    }
}
