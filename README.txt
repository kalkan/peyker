3D NORAD Uydu Takipçisi

Dosyalar:
- index.html
- styles.css
- main.js

Yerel çalıştırma:
1. Klasörü VS Code ile aç.
2. Live Server eklentisi kur.
3. index.html dosyasına sağ tık -> Open with Live Server.

GitHub Pages yükleme:
1. GitHub'da yeni bir public repo oluştur. Örnek: norad-3d-tracker
2. Bu klasördeki tüm dosyaları repo içine yükle.
3. Repo ayarları > Pages > Build and deployment > Source = Deploy from a branch
4. Branch = main, Folder = /(root)
5. Save de.
6. Birkaç dakika sonra site şu biçimde açılır:
   https://KULLANICI_ADIN.github.io/norad-3d-tracker/

Önemli:
- Kullanıcı 'Google Pages' dediyse pratikte çoğu zaman kastedilen servis GitHub Pages oluyor.
- Bu proje statik olduğu için GitHub Pages için uygundur.
- NORAD TLE verisi CelesTrak üzerinden çekilir.
