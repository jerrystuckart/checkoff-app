#!/bin/sh
# Set the booted iOS Simulator's foreground GPS. Usage: scripts/hub-sim-location.sh <name|lat,lng>
set -e
case "$1" in
  willcox-01-at-rixs-tavern|willcox-01) LL="32.2516952,-109.8333493" ;;
  willcox-02-between-venues|willcox-02) LL="32.248,-109.84" ;;
  willcox-03-edge-inside|willcox-03) LL="32.61262,-109.8326" ;;
  willcox-04-edge-outside|willcox-04) LL="32.61622,-109.8326" ;;
  willcox-05-at-historic-theater|willcox-05) LL="32.2526337,-109.8313725" ;;
  positano-01-at-torre-trasita|positano-01) LL="40.6263545,14.4822477" ;;
  positano-02-between-venues|positano-02) LL="40.63,14.49" ;;
  positano-03-edge-inside|positano-03) LL="40.6909,14.485" ;;
  positano-04-edge-outside|positano-04) LL="40.6919,14.485" ;;
  *) LL="$1" ;;
esac
xcrun simctl location booted set "$LL"
echo "simulator location -> $LL"
