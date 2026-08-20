.PHONY: dev build check test mobile mobile-clear dashboard

dev:
	npm run dev

dashboard:
	npm --prefix apps/dashboard run dev

mobile:
	script -q -c "npm --prefix apps/mobile run start -- $(FLAGS)" /tmp/metro.log

mobile-clear:
	script -q -c "npm --prefix apps/mobile run start -- --clear" /tmp/metro.log

check:
	cargo check -p server

build:
	cargo build -p server

test:
	cargo test -p server
