#!/bin/bash
cd "$(dirname "$0")/worker" && npm run deploy && git -C .. push
