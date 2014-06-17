rsync -r --delete extension/ deploy

cat extension/keys.js | sed s/{API_KEY}/$1/ | sed s/{CLIENT_ID}/$2/ > deploy/keys.js
cat extension/manifest.json | sed s/{CLIENT_ID}/$2/ > deploy/manifest.json

cd deploy
zip -r ../cloud-debug-$(date "+%Y_%m_%d_%H_%M_%S").zip *
cd ..
