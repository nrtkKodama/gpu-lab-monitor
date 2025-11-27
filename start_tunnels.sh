#!/bin/bash
# Auto-generated script to start SSH tunnels using sshpass
# Ensure sshpass is installed: sudo apt install sshpass

SSH_USER="hamalab"
SSH_PASS="miharukasu"

echo 'Starting SSH Tunnels...'

sshpass -p "$SSH_PASS" ssh -f -N -L 18001:localhost:8000 -p 22 $SSH_USER@192.168.31.100 -o StrictHostKeyChecking=no
echo "Started tunnel for Typhoon (192.168.31.100:22) on port 18001"
sshpass -p "$SSH_PASS" ssh -f -N -L 18002:localhost:8000 -p 22 $SSH_USER@192.168.31.110 -o StrictHostKeyChecking=no
echo "Started tunnel for Graveler (192.168.31.110:22) on port 18002"
sshpass -p "$SSH_PASS" ssh -f -N -L 18003:localhost:8000 -p 22 $SSH_USER@192.168.31.120 -o StrictHostKeyChecking=no
echo "Started tunnel for Zekrom (192.168.31.120:22) on port 18003"
sshpass -p "$SSH_PASS" ssh -f -N -L 18004:localhost:8000 -p 22 $SSH_USER@192.168.31.142 -o StrictHostKeyChecking=no
echo "Started tunnel for BigMouse (192.168.31.142:22) on port 18004"
sshpass -p "$SSH_PASS" ssh -f -N -L 18005:localhost:8000 -p 22 $SSH_USER@192.168.31.150 -o StrictHostKeyChecking=no
echo "Started tunnel for DL-BOX (192.168.31.150:22) on port 18005"
sshpass -p "$SSH_PASS" ssh -f -N -L 18006:localhost:8000 -p 22 $SSH_USER@133.34.30.196 -o StrictHostKeyChecking=no
echo "Started tunnel for Raijin (133.34.30.196:22) on port 18006"
sshpass -p "$SSH_PASS" ssh -f -N -L 18007:localhost:8000 -p 222 $SSH_USER@133.34.30.196 -o StrictHostKeyChecking=no
echo "Started tunnel for Cervo (133.34.30.196:222) on port 18007"
sshpass -p "$SSH_PASS" ssh -f -N -L 18008:localhost:8000 -p 322 $SSH_USER@133.34.30.196 -o StrictHostKeyChecking=no
echo "Started tunnel for Rotom (133.34.30.196:322) on port 18008"
sshpass -p "$SSH_PASS" ssh -f -N -L 18009:localhost:8000 -p 22 $SSH_USER@133.34.30.199 -o StrictHostKeyChecking=no
echo "Started tunnel for Chatot (133.34.30.199:22) on port 18009"

echo 'All tunnels started.'