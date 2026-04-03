@echo off
echo Pushing dataforge-site to repo...
git subtree push --prefix=dataforge-site site main
echo Done!
pause
