
'use strict';

const querystring = require('querystring'),
      serveStatic = require('serve-static'),
      bodyParser  = require('body-parser'),
      intoStream  = require('into-stream'),
      connect     = require('connect'),
      exec        = require('child_process').exec,
      mime        = require('mime-types'),
      http        = require('http'),
      path        = require('path'),
      ejs         = require('ejs'),
      fs          = require('fs');


const statusCodes = http.STATUS_CODES,
      config      = require('./config.json'),
      cateArr     = config.category.split('|'),
      docPath     = config.docPath,
      args        = process.argv.slice(2),
      port        = (args[0] && /^\d+$/.test(args[0])) ? parseInt(args[0]) : 8063,
      app         = new connect();


/* body parsing middleware */
app.use(bodyParser.json({type: 'application/json'}))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(serveStatic(config.origin))

app.use( (req, res, next) => {
    /* support cors */
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Headers","*");
    res.setHeader("X-Powered-By","node/5.2.0");
    res.setHeader("Access-Control-Allow-Methods","PUT,POST,GET,DELETE,OPTIONS");
    return next();
})

/* git hooks */
app.use('/hook', (req, res, next) => {
    let body = req.body,
        qs = querystring.parse(req._parsedUrl.query);

    if (req.method !== 'POST') {
        return next(405)
    }

    if (body.ref !== 'refs/heads/master') {
        return next(JSON.stringify({"code" : 406, "msg" : "Bad request origin"})) 
    }
    if ( !qs.token === 'document') {
        return next(JSON.stringify({"code" : 406, "msg" : "Bad token"}))   
    }

    return res.end()
})

app.use("/editor/", (req, res, next) => {
    let route  = decodeURIComponent(req.url).replace(/\/$/,''),
        type = path.extname(route),
        data = {
            markContent : '',
            title : '',
            cates : cateArr,
            selected : ''
        },
        editPath = config.edit + "index.html",
        filePath;
    if(type){
        res.writeHead(200,{
            'Content-Type':  mime.lookup(type) + '; charset=UTF-8'
        });
        fs.createReadStream(config.edit + route).pipe(res);
    }else{
        if(route !== '/new'){
            filePath = config.markdown + route + ".md";
            if(fs.existsSync(filePath)){
                sendFile(filePath).then((filedata) => {
                    let _parse       = Object.keys(querystring.parse(filedata,'---',null)),
                        _obj         = querystring.parse(_parse[1],'\n',': '),
                        _title       = _obj["title"],
                        _cate        = _obj["categories"];
                    data.title       = _title;
                    data.selected    = _cate;
                    data.markContent = _parse[2];
                    return render(editPath, data)
                }).then((result) => {
                    res.writeHead(200,{
                        'Content-Type': 'text/html; charset=UTF-8'
                    });
                    intoStream(result).pipe(res);
                },(err) => {
                    next(String(err))
                })
            }else{
                next(404);
            }   
        }else{
            render(editPath, data).then((result) => {
                res.writeHead(200,{
                    'Content-Type': 'text/html; charset=UTF-8'
                });
                intoStream(result).pipe(res);
            },(err) => {
                next(String(err))
            })
        }
    }
})

app.use('/delete', (req, res, next) => {
    let route      = decodeURIComponent(req.url).replace(/\/$/,''),
        filePath   = config.markdown + route + ".md",
        statusCode = 200,
        data = {
            'code' : 0,
            'msg' : ''
        }
    if (isAjax(req)) {
        if ( req.method !== 'POST' ) {
            return next(405)
        }
        if(fs.existsSync(filePath)){
            try{
                fs.unlinkSync(filePath);
                exec('sh generate.sh ' + docPath, (err, stdout, stderr) => {
                    if(err || stderr){
                        statusCode = 500;
                        data.code  = 3;
                        data.msg   = "Internal Server Error";
                    }else{
                        data.msg   = "delete success";
                        res.writeHead(statusCode, {
                            "Content-Type" : "application/json"
                        })
                        res.end(new Buffer(JSON.stringify(data, null, 4)));
                    }
                })
                return;
            } catch(e) {
                statusCode = 500;
                data.code  = 2;
                data.msg   = "Internal Server Error"
            }
        }else{
            statusCode = 404
            data.code  = 1;
            data.msg   = "Not Found"
        }
        res.writeHead(statusCode, {
            "Content-Type" : "application/json"
        })
        res.end(new Buffer(JSON.stringify(data, null, 4)));
    } else {
      next(406);
    }

})

/* save new document */
app.use('/save', (req, res, next) => {
    if (isAjax(req)) {
        if ( req.method !== 'POST' ) {
            return next(405)
        }

        let body       = req.body,
            content    = body.content,
            statusCode = 200,
            data = {
                'code' : 0,
                'msg' : ''
            }
        
        if ( body.title.trim() === '' ) {
            statusCode = 406;
            data.code  = 1;
            data.msg   = "title is empty";
        }

        if ( body.content.trim() === '' ) {
            statusCode = 406;
            data.code  = 1;
            data.msg   = "content is empty";
        }

        body.categories = cateArr[body.categories];
        body.toc = true;

        let md = '---\n';
        delete body.content
        body.date = dateFormate(new Date())
        md += querystring.stringify(body, '\n', ': ',{
            encodeURIComponent : (e) => {
                return e
            }
        });
        md += '\n---\n'
        md += content
        
        try{
            let writeStream = fs.createWriteStream(config.markdown + "/" + body.title.trim() + '.md', {encoding: 'utf8'});
            intoStream(md).pipe(writeStream);
            writeStream.on("finish", () => {
                exec('sh generate.sh ' + docPath, (err, stdout, stderr) => {
                    if(err || stderr){
                        statusCode = 500;
                        data.code  = 3;
                        data.msg   = "Internal Server Error";
                    }else{
                        data.msg   = "delete success";
                        res.writeHead(statusCode, {
                            "Content-Type" : "application/json"
                        })
                        res.end(new Buffer(JSON.stringify(data, null, 4)));
                    }
                })
            })
        } catch(e) {
            statusCode = 500;
            data.code  = 2;
            data.msg   = "write fail";
            res.writeHead(statusCode, {
                "Content-Type" : "application/json"
            })
            res.end(new Buffer(JSON.stringify(data, null, 4)));
        }
    } else {
        next(406);
    }
})

/* handle err */
app.use( (err, req, res, next) => {
    let code = 500,
        msg  = '';
    if( typeof err === 'number' ){
        code = err;
        msg  = statusCodes[code];
    }else{
        try{
            let err = JSON.parse(err);
            code = err.code;
            msg  = err.msg;
        }catch(e){
            msg = err;
        }
    }

    if(code === 404){
        msg = '<center><h1>404 Not Found</h1></center><hr><center>';
        res.writeHead(code, {
            'Content-Type' : 'text/html; charset=UTF-8'
        });
    }else{
        res.statusCode = code;
    }

    res.end(new Buffer(msg));
})

function render(paths, data){
    return new Promise((resolve, reject) => {
        ejs.renderFile(paths, data, (err, str) => {
            if (err) {
                reject(err)
            } else {
                resolve(str);
            }
        });
    })
}

function sendFile(fpath) {
    return new Promise( (resolve) => {
        let chunks = [],
            size = 0,
            buf,
            str;
        let rs  = fs.createReadStream(fpath);
        rs.on("data",(chunk) => {
            chunks.push(chunk);
            size += chunk.length
        })
        rs.on("end",() => {
            buf = Buffer.concat(chunks,size);
            resolve(String(buf))
        })
    })
}

function isAjax(req){
    return req.headers['x-requested-with'] && req.headers['x-requested-with'].toLowerCase() == 'xmlhttprequest';
}

function dateFormate(date) {
    let s = '';
    s += [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-') + " ";
    s += [date.getHours(), date.getMinutes(), date.getSeconds()].join(':')
    return s;
}

http.createServer(app).listen(port)
console.log('server run at %s port', port)