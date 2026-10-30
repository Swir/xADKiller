"""Validate privacy and production-package assumptions before release signing."""
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
ns = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(root / 'app/src/main/AndroidManifest.xml').getroot()
app = manifest.find('application')
assert app.get(ns + 'allowBackup') == 'false'
assert app.get(ns + 'usesCleartextTraffic') == 'false'
assert app.get(ns + 'dataExtractionRules') == '@xml/data_extraction_rules'
assert app.get(ns + 'debuggable') != 'true'
assert not any(p.get(ns + 'name') == 'android.permission.QUERY_ALL_PACKAGES' for p in manifest.findall('uses-permission'))
vpn = [s for s in app.findall('service') if s.get(ns + 'name') == '.AdBlockVpnServiceV121']
assert len(vpn) == 1 and vpn[0].get(ns + 'permission') == 'android.permission.BIND_VPN_SERVICE'
assert vpn[0].get(ns + 'exported') == 'false'
receiver = [r for r in app.findall('receiver') if r.get(ns + 'name') == '.BootReceiverV121']
assert len(receiver) == 1 and receiver[0].get(ns + 'exported') == 'false'
network = ET.parse(root / 'app/src/main/res/xml/network_security_config.xml').getroot()
assert network.find('base-config').get('cleartextTrafficPermitted') == 'false'
assert [a.get('src') for a in network.findall('.//certificates')] == ['system']
for extension in ('*.p12', '*.jks', '*.keystore'):
    assert not list((root / 'app/src').rglob(extension)), 'Private key in application sources'
print('Android privacy and production configuration: PASS')
