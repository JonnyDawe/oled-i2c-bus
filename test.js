let data = [1];
let buf = Buffer.from(data);

console.log(data);
console.log(buf);
console.log(buf[0]);

class Test {
  constructor() {
    this.testval = "hat";
  }

  methodtest = () => {
    console.log(this.testval);
  };

  exampleTest() {
    let hat = function () {
      console.log(this.testval);
    };
    hat();
  }
}

inst = new Test();
inst.methodtest();
inst.exampleTest();
