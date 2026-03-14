Uydu Takip Platformu (2B + 3B)
==============================

Bu sürümde:
- 2B işlevsel arayüz (Leaflet tabanlı)
- 3B canlı takip arayüzü (CesiumJS tabanlı)
- NORAD ID ile uydu yükleme
- Hızlı seçim: İMECE ve Göktürk-2
- 2B tahmin takvimi ile gelecekteki ground track çizimi
- 2B KML dışa aktarma (canlı iz ve tahmin izi)
- 3B kamera kontrol butonları

Dosyalar
--------
- index.html
- styles.css
- main.js

Yerelde Çalıştırma
------------------
1. ZIP'i aç.
2. Klasörü VS Code ile aç.
3. Live Server eklentisini kur.
4. index.html dosyasını Live Server ile aç.

GitHub Pages'a Yükleme
----------------------
1. GitHub'da yeni bir public repo oluştur.
2. index.html, styles.css ve main.js dosyalarını repo köküne yükle.
3. Repo içinde Settings > Pages menüsüne git.
4. Source olarak "Deploy from a branch" seç.
5. Branch olarak "main", folder olarak "/ (root)" seç.
6. Save butonuna bas.
7. Birkaç dakika sonra site şu adreste yayınlanır:
   https://KULLANICI_ADIN.github.io/REPO_ADI/

Notlar
------
- TLE verisi CelesTrak servisinden alınır.
- 2B harita OpenStreetMap + Leaflet ile çalışır.
- 3B görünüm CesiumJS kullanır.
- Yörünge hesabı satellite.js ile yapılır.
- Proje tamamen statik hosting uyumludur; backend gerektirmez.
