package com.swir.xadkiller;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.Test;

public class DnsQuestionCompressionHardeningTest {
    @Test public void rejectsCompressedQuestionPointerIntoDnsHeader() {
        byte[] dns = new byte[18];
        // Craft a header that also decodes as the label "a" at offset 0. Before this
        // hardening, a QNAME pointer C0 00 could make the blocker accept that header data
        // as the queried hostname even though a normal single-question query has nothing
        // legitimate to compress against.
        dns[0] = 1;
        dns[1] = 'a';
        DnsPacket.put16(dns, 2, 0x0000);
        DnsPacket.put16(dns, 4, 1);
        DnsPacket.put16(dns, 6, 0);
        DnsPacket.put16(dns, 8, 0);
        DnsPacket.put16(dns, 10, 0);
        dns[12] = (byte) 0xC0;
        dns[13] = 0;
        DnsPacket.put16(dns, 14, 1);
        DnsPacket.put16(dns, 16, 1);

        byte[] packet = packet(dns);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void keepsOrdinaryUncompressedQuestionCompatible() {
        byte[] packet = packet(query("ads.example.com"));
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet, packet.length);
        assertNotNull(parsed);
    }

    private static byte[] query(String host) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write16(out, 0x1234);
        write16(out, 0x0100);
        write16(out, 1);
        write16(out, 0);
        write16(out, 0);
        write16(out, 0);
        for (String label : host.split("\\.")) {
            byte[] bytes = label.getBytes(StandardCharsets.US_ASCII);
            out.write(bytes.length);
            out.write(bytes, 0, bytes.length);
        }
        out.write(0);
        write16(out, 1);
        write16(out, 1);
        return out.toByteArray();
    }

    private static byte[] packet(byte[] dns) {
        byte[] out = new byte[20 + 8 + dns.length];
        out[0] = 0x45;
        DnsPacket.put16(out, 2, out.length);
        DnsPacket.put16(out, 6, 0x4000);
        out[8] = 64;
        out[9] = 17;
        out[12] = 10;
        out[13] = 0;
        out[14] = 0;
        out[15] = 2;
        out[16] = 10;
        out[17] = 0;
        out[18] = 0;
        out[19] = 1;
        DnsPacket.put16(out, 20, 53000);
        DnsPacket.put16(out, 22, DnsPacket.DNS_PORT);
        DnsPacket.put16(out, 24, 8 + dns.length);
        DnsPacket.put16(out, 26, 0);
        System.arraycopy(dns, 0, out, 28, dns.length);
        return out;
    }

    private static void write16(ByteArrayOutputStream out, int value) {
        out.write((value >>> 8) & 0xFF);
        out.write(value & 0xFF);
    }
}
