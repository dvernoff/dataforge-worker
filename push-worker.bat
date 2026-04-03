@echo off
echo Pushing worker-node to public repo...
git subtree push --prefix=worker-node worker main
echo Done!
pause
