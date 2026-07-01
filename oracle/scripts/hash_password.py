"""Generate a bcrypt hash for APP_PASSWORD_HASH in your .env.

Usage (from oracle/):
    ./.venv/Scripts/python scripts/hash_password.py
Prompts for a password (hidden input) and prints the hash to stdout.
"""

import getpass

from app.core.security import hash_password


def main() -> None:
    password = getpass.getpass("Password: ")
    if not password:
        raise SystemExit("No password provided.")
    print(hash_password(password))


if __name__ == "__main__":
    main()
