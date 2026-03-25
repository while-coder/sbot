#!/bin/bash
set -eux

apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-pip git subversion \
  && rm -rf /var/lib/apt/lists/*

mkdir -p /paths/
