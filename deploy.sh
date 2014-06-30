cd client_app
zip -r ../client_app-$(date "+%Y_%m_%d_%H_%M_%S").zip *
cd ..

cd server_extension
zip -r ../server_extension-$(date "+%Y_%m_%d_%H_%M_%S").zip *
cd ..
