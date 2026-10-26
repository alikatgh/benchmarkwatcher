"""Compile/test pure Kotlin contracts using existing cached jars; no downloads.

This does not compile Compose screens, package an APK, or run a device.
"""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path.home() / '.gradle/caches/modules-2/files-2.1'


def jar(group, module, version):
    files = sorted((CACHE / group / module / version).glob('*/*.jar'))
    if not files:
        raise SystemExit(f'Missing cached dependency: {group}:{module}:{version}. No download attempted.')
    return str(files[0])


def main():
    java_home = os.environ.get('JAVA_HOME')
    java = str(Path(java_home) / 'bin/java') if java_home else 'java'
    compiler = [jar('org.jetbrains.kotlin', module, '2.0.21') for module in
                ('kotlin-compiler-embeddable', 'kotlin-stdlib', 'kotlin-script-runtime')]
    compiler += [jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
                 jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'),
                 jar('org.jetbrains', 'annotations', '13.0'),
                 jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.6.4')]
    dependencies = [jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.0.21'),
                    jar('org.jetbrains', 'annotations', '13.0'),
                    jar('org.json', 'json', '20240303'),
                    jar('junit', 'junit', '4.13.2'),
                    jar('org.hamcrest', 'hamcrest-core', '1.3')]
    android = ROOT / 'native/android'
    output = android / '.build/core-tests'
    output.mkdir(parents=True, exist_ok=True)
    paths = [android / 'app/src/main/java/com/benchmarkwatcher/nativeapp/ResearchModels.kt',
             android / 'app/src/test/java/com/benchmarkwatcher/nativeapp/ResearchModelsTest.kt']
    subprocess.run([java, '-Xmx256m', '-cp', os.pathsep.join(compiler),
                    'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect',
                    '-jvm-target', '17', '-classpath', os.pathsep.join(dependencies),
                    '-d', str(output), *map(str, paths)], check=True)
    subprocess.run([java, '-cp', os.pathsep.join([str(output), str(android / 'app/src/test/resources'), *dependencies]),
                    'org.junit.runner.JUnitCore', 'com.benchmarkwatcher.nativeapp.ResearchModelsTest'], check=True)


if __name__ == '__main__':
    main()
