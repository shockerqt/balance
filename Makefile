.PHONY: dev build check test mobile mobile-clear

dev:
	npm run dev

mobile:
	script -q -c "npm --prefix apps/mobile run start -- $(FLAGS)" /tmp/metro.log

mobile-clear:
	script -q -c "npm --prefix apps/mobile run start -- --clear" /tmp/metro.log

check:
	cargo check -p server

build:
	npm --prefix apps/dashboard run build && cargo build -p server

test:
	npm --prefix apps/dashboard run typecheck && cargo test -p server
