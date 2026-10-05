package com.swir.xadkiller;

final class DashboardStatusModel {
    static final long VPN_FRESH_MS = 12_000L;
    static final long SMART_FRESH_MS = 15_000L;
    static final long UPDATE_STALE_MS = 7L * 24L * 60L * 60L * 1000L;

    enum VpnState { ACTIVE, STALE, OFF }
    enum DnsState { READY, STRICT_CONFLICT, NO_NETWORK }
    enum BlocklistState { READY, STARTER_ONLY, EMPTY }
    enum SmartState { LIVE, WAITING, DETECTOR_OFF, SERVICE_OFF }
    enum UpdateState { FRESH, STALE, NEVER }
    enum RecoveryAction { NONE, OPEN_PRIVATE_DNS, START_VPN, UPDATE_BLOCKLIST, OPEN_ACCESSIBILITY }

    final VpnState vpn;
    final DnsState dns;
    final BlocklistState blocklist;
    final SmartState smart;
    final UpdateState update;
    final RecoveryAction recovery;
    final int healthyCount;

    private DashboardStatusModel(
            VpnState vpn,
            DnsState dns,
            BlocklistState blocklist,
            SmartState smart,
            UpdateState update,
            RecoveryAction recovery,
            int healthyCount) {
        this.vpn = vpn;
        this.dns = dns;
        this.blocklist = blocklist;
        this.smart = smart;
        this.update = update;
        this.recovery = recovery;
        this.healthyCount = healthyCount;
    }

    static DashboardStatusModel evaluate(
            long nowMs,
            boolean vpnRequested,
            long vpnHeartbeatMs,
            boolean networkAvailable,
            boolean strictPrivateDnsConflict,
            int domainCount,
            boolean fullListLoaded,
            long lastUpdateMs,
            boolean smartServiceEnabled,
            boolean smartDetectorEnabled,
            long smartHeartbeatMs) {

        VpnState vpn;
        if (vpnRequested && fresh(nowMs, vpnHeartbeatMs, VPN_FRESH_MS)) vpn = VpnState.ACTIVE;
        else if (vpnRequested) vpn = VpnState.STALE;
        else vpn = VpnState.OFF;

        DnsState dns = !networkAvailable
                ? DnsState.NO_NETWORK
                : strictPrivateDnsConflict ? DnsState.STRICT_CONFLICT : DnsState.READY;

        BlocklistState blocklist = domainCount <= 0
                ? BlocklistState.EMPTY
                : fullListLoaded ? BlocklistState.READY : BlocklistState.STARTER_ONLY;

        SmartState smart;
        if (!smartServiceEnabled) smart = SmartState.SERVICE_OFF;
        else if (!smartDetectorEnabled) smart = SmartState.DETECTOR_OFF;
        else if (fresh(nowMs, smartHeartbeatMs, SMART_FRESH_MS)) smart = SmartState.LIVE;
        else smart = SmartState.WAITING;

        UpdateState update;
        if (lastUpdateMs <= 0L) update = UpdateState.NEVER;
        else if (lastUpdateMs > nowMs || nowMs - lastUpdateMs <= UPDATE_STALE_MS) update = UpdateState.FRESH;
        else update = UpdateState.STALE;

        RecoveryAction recovery;
        if (dns == DnsState.STRICT_CONFLICT) recovery = RecoveryAction.OPEN_PRIVATE_DNS;
        else if (vpn != VpnState.ACTIVE) recovery = RecoveryAction.START_VPN;
        else if (blocklist != BlocklistState.READY || update != UpdateState.FRESH) recovery = RecoveryAction.UPDATE_BLOCKLIST;
        else if (smart == SmartState.SERVICE_OFF && smartDetectorEnabled) recovery = RecoveryAction.OPEN_ACCESSIBILITY;
        else recovery = RecoveryAction.NONE;

        int healthy = 0;
        if (vpn == VpnState.ACTIVE) healthy++;
        if (dns == DnsState.READY) healthy++;
        if (blocklist == BlocklistState.READY) healthy++;
        if (smart == SmartState.LIVE || smart == SmartState.WAITING || smart == SmartState.DETECTOR_OFF) healthy++;
        if (update == UpdateState.FRESH) healthy++;

        return new DashboardStatusModel(vpn, dns, blocklist, smart, update, recovery, healthy);
    }

    private static boolean fresh(long nowMs, long heartbeatMs, long maxAgeMs) {
        return heartbeatMs > 0L && heartbeatMs <= nowMs && nowMs - heartbeatMs <= maxAgeMs;
    }
}
