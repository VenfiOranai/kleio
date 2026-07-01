# --- Build the Angular app ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build

# --- Serve static files + reverse-proxy /api ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/herald/browser /usr/share/nginx/html
EXPOSE 80
