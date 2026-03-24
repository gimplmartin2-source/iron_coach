# Oracle Cloud - Kostenloser Server (Dauerhaft gratis)

> ⚠️ **Komplexität:** Hoch | **Zeitaufwand:** ~45 Minuten
> Aber: Wirklich für immer gratis (2 VMs, 4GB RAM, 200GB Storage)

---

## Schritt 1: Oracle Cloud Account erstellen

🔗 **Link:** https://signup.oraclecloud.com

**WICHTIG:**
- Kreditkarte wird benötigt (für Verifikation, wird **nicht** belastet für Always Free)
- Adresse angeben
- Account dauert ~5 Minuten

---

## Schritt 2: VM erstellen (Compute Instance)

1. Login → https://cloud.oracle.com
2. Menü ≡ → **Compute** → **Instances**
3. **Create Instance** klicken

**Einstellungen:**

| Feld | Wert |
|------|------|
| Name | `ironcoach-server` |
| Compartment | Default (dein Name) |
| Placement | AD-1 (irgendwo in Europa) |
| Image | **Oracle Linux 8** (oder Ubuntu 22.04 Minimal) |
| Shape | **Ampere** (ARM) → VM.Standard.A1.Flex |
| OCPUs | 1 |
| Memory | 1 GB |
| Boot Volume | 50 GB |
| **Add SSH keys** | **Generate SSH key pair** klicken! |

4. **Save private key** (wichtig!)
5. **Create**

**⏳ Warte ~2 Minuten bis Status "Running"**

---

## Schritt 3: Security Rules (Firewall öffnen)

1. Im Menü: **Networking** → **Virtual Cloud Networks**
2. Klicke auf dein VCN
3. Links: **Security Lists**
4. Wähle die Default Security List
5. **Add Ingress Rule** (2x wiederholen):

**Regel 1 (HTTP):**
- Stateless: No
- Source Type: CIDR
- Source CIDR: `0.0.0.0/0`
- IP Protocol: TCP
- Destination Port Range: `80`

**Regel 2 (HTTPS):**
- Stateless: No
- Source Type: CIDR
- Source CIDR: `0.0.0.0/0`
- IP Protocol: TCP
- Destination Port Range: `443`

**Regel 3 (App Port):**
- Stateless: No
- Source Type: CIDR
- Source CIDR: `0.0.0.0/0`
- IP Protocol: TCP
- Destination Port Range: `3000`

6. **Save** (kann 1-2 Minuten dauern)

---

## Schritt 4: SSH verbinden

**Public IP kopieren:** (steht bei deiner Instance, z.B. `132.145.123.45`)

**Windows PowerShell:**
```powershell
# Zum Ordner wechseln wo der SSH Key ist
cd C:\Users\DEIN_NAME\Downloads

# Rechte setzen (nur du darfst lesen)
icacls "ssh-key-2024-03-20.key" /inheritance:r
icacls "ssh-key-2024-03-20.key" /grant:r "%username%:R"

# Verbinden (USERNAME = opc für Oracle Linux, ubuntu für Ubuntu)
ssh -i "ssh-key-2024-03-20.key" opc@132.145.123.45
```

---

## Schritt 5: Server einrichten

**Auf dem Server (nach SSH Login):**

```bash
# Als root werden
sudo -i

# Node.js installieren (Oracle Linux)
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs git

# ODER für Ubuntu:
# curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
# apt-get install -y nodejs git

# Verzeichnis erstellen
mkdir -p /opt/ironcoach
cd /opt/ironcoach

# Code vom GitHub holen (DEIN_USER ersetzen!)
git clone https://github.com/DEIN_USER/ironcoach-webapp.git .

# Dependencies installieren
npm install

# Environment Variables setzen
cat > .env << 'EOF'
JWT_SECRET=mYq3t6w9z$C&F)H@McQfTjWnZr4u7x!AmYq3t6w9z$C&F)H@M
SESSION_SECRET=G+KbPeShVmYq3t6w9z$C&F)H@McQfTjWnZr4u7x!A%D*G-KaP
NODE_ENV=production
PORT=3000
EOF

# App testen
npm start
```

**Test:** `http://132.145.123.45:3000` im Browser öffnen.

**Wenn es läuft → STRG+C zum Beenden**

---

## Schritt 6: Als Service starten (PM2)

```bash
# PM2 installieren
npm install -g pm2

# App mit PM2 starten
pm2 start server.js --name "ironcoach"

# Autostart einrichten
pm2 startup systemd
pm2 save

# Status checken
pm2 status
```

---

## Schritt 7: Nginx + SSL (Let's Encrypt)

```bash
# Nginx installieren
yum install -y nginx  # Oracle Linux
# apt install -y nginx  # Ubuntu

# Certbot installieren
yum install -y certbot python3-certbot-nginx

# Domain eintragen (falls du eine hast)
# Sonst mit IP weiter
```

**Wenn du keine Domain hast:**
→ Du kannst die App direkt über `http://132.145.123.45:3000` nutzen (nicht ideal, aber funktioniert)

**Mit Domain (z.B. trainieren.deinname.com):**
1. DNS A-Record auf `132.145.123.45` zeigen lassen
2. Nginx config erstellen:

```bash
cat > /etc/nginx/conf.d/ironcoach.conf << 'EOF'
server {
    listen 80;
    server_name trainieren.deinname.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Starten
systemctl start nginx
systemctl enable nginx

# SSL einrichten
certbot --nginx -d trainieren.deinname.com
```

---

## Schritt 8: Fertig! 🎉

**Deine App läuft auf:**
- `http://132.145.123.45:3000` (ohne Domain)
- `https://trainieren.deinname.com` (mit Domain)

---

## Nützliche Befehle

```bash
# Logs ansehen
pm2 logs

# App neustarten
pm2 restart ironcoach

# Server neustarten
reboot

# Updates
yum update -y
```

---

## Troubleshooting

**"Permission denied" bei SSH:**
→ SSH Key Rechte prüfen: `chmod 600 dein-key.key`

**"Port nicht erreichbar":**
→ Security List in OCI prüfen (Port 3000 offen?)

**App startet nicht:**
→ `pm2 logs` → Fehler lesen

**Speicher voll:**
→ `df -h` → `rm -rf /opt/ironcoach/node_modules && cd /opt/ironcoach && npm install --production`

---

## Kosten

**Immer gratis:**
- 2 AMD VMs (oder 1 ARM VM mit bis zu 4 OCPUs)
- 200GB Block Storage
- 10TB Traffic/Monat

**Nie kostenpflichtig** solange du unter Always Free bleibst!