#!/usr/bin/env python3
"""
Kernel launcher script for python-lite-notebook extension.
Starts an ipykernel instance and writes connection info to a specified file.
"""
import json
import os
import sys
import tempfile
import time
from ipykernel.kernelapp import IPKernelApp


def main():
    if len(sys.argv) < 3 or sys.argv[1] != '-f':
        print("Usage: python kernel_launcher.py -f <connection_file>")
        sys.exit(1)

    connection_file = sys.argv[2]

    # Ensure the directory exists
    os.makedirs(os.path.dirname(os.path.abspath(connection_file)), exist_ok=True)

    # Configure and start the kernel
    app = IPKernelApp.instance()
    app.initialize(['python-lite-notebook-kernel', '-f', connection_file])
    app.start()


if __name__ == '__main__':
    main()