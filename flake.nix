{
  description = "JiraExporter Chrome Extension dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "build-jira-exporter" ''
            set -euo pipefail
            if [ ! -f package.json ]; then
              echo "Error: run this from the JiraExporter repo root" >&2
              exit 1
            fi
            export PATH="${pkgs.lib.makeBinPath [ pkgs.nodejs_20 pkgs.pnpm ]}:$PATH"
            echo "==> Installing dependencies…"
            pnpm install --frozen-lockfile 2>/dev/null || pnpm install
            echo "==> Building extension…"
            pnpm build
            echo ""
            echo "✓ Build complete. Load dist/ as an unpacked extension in chrome://extensions"
          '');
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            pnpm
            zip
          ];

          shellHook = ''
            echo "JiraExporter dev shell — Node $(node -v), pnpm $(pnpm -v)"
          '';
        };
      });
}
