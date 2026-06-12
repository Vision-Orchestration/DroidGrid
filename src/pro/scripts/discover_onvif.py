#!/usr/bin/env python3
"""
ONVIF camera discovery for DroidGrid Pro.
Scans the local subnet for ONVIF-compatible cameras.
"""
import json
import socket
import sys
from urllib.parse import urlparse


def discover_onvif_cameras(timeout=3):
    """Scan for ONVIF cameras via WS-Discovery."""
    try:
        from wsdiscovery.discovery import ThreadedWSDiscovery
        wsd = ThreadedWSDiscovery()
        wsd.start()
        services = wsd.searchServices(timeout=timeout)
        wsd.stop()
        cameras = []
        for s in services:
            scopes = list(s.getScopes())
            if any("onvif" in str(sc).lower() for sc in scopes):
                addr = s.getXAddrs()[0] if s.getXAddrs() else ""
                parsed = urlparse(addr)
                cameras.append({
                    "address": addr,
                    "ip": parsed.hostname or "",
                    "port": parsed.port or 80,
                    "types": str(s.getTypes()),
                    "scopes": scopes[:3],
                })
        return cameras
    except ImportError:
        return []


def scan_subnet(subnet="192.168.1", port=4747, timeout=1):
    """Quick TCP scan for DroidCam devices on a subnet."""
    found = []
    for i in range(1, 255):
        ip = f"{subnet}.{i}"
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            result = s.connect_ex((ip, port))
            s.close()
            if result == 0:
                found.append({"ip": ip, "port": port, "type": "droidcam"})
        except Exception:
            pass
    return found


if __name__ == "__main__":
    onvif = discover_onvif_cameras()
    droidcam = scan_subnet()
    all_cameras = onvif + droidcam
    print(json.dumps(all_cameras, indent=2))
