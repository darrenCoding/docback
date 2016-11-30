#!/bin/sh
path=$1

cd $path
sudo rm -rf public
sudo hexo g