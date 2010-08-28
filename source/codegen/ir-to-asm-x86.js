/**
@fileOverview

Translate the low-level IR to machine dependent assembly code.

@copyright
Copyright (c) 2010 Tachyon Javascript Engine, All Rights Reserved
*/

/** @namespace */
var irToAsm = irToAsm || {};

(function () { // local namespace

const reg = x86.Assembler.prototype.register;
const ESP = reg.esp;
const EBP = reg.ebp;
const EAX = reg.eax;
const EBX = reg.ebx;
const ECX = reg.ecx;
const EDX = reg.edx;
const ESI = reg.esi;
const EDI = reg.edi;
const $   = x86.Assembler.prototype.immediateValue;
const mem = x86.Assembler.prototype.memory;

// Global object properties
const G_NEXT_OFFSET = 0;  // Offset for the cell containing 
                          // the next empty entry offset
const G_NEXT_OFFSET_WIDTH = 32;
const G_FIRST_OFFSET = 4; // Length value is 4 bytes
const G_KEY_OFFSET   = 0; // Key offset is 0 (we iterate over keys)
const G_KEY_WIDTH = 32;
const G_VALUE_OFFSET = 4; // Value offset is 4 (key length is 4 bytes)
const G_VALUE_WIDTH = 32;
const G_ENTRY_LENGTH = 8; // Key (4 bytes) Value (4 bytes)

irToAsm.config = {};

// Constant values 
irToAsm.config.TRUE  = $(1); 
irToAsm.config.FALSE = $(0);
irToAsm.config.NULL  = $(0);
irToAsm.config.UNDEFINED = $(0);

// Global object configuration
irToAsm.config.maxGlobalEntries = 4;

// Register configuration
irToAsm.config.scratch = EDI;
// TODO: replace stack handling in ir_call and ir_ret to allow
//       using EBP instead of ESP
irToAsm.config.stack   = ESP;
irToAsm.config.context = EDX;
irToAsm.config.funcObjReg = EAX;
irToAsm.config.thisObjReg = EBX;
irToAsm.config.argsReg    = [ECX];



irToAsm.translator = function ()
{
    var that = Object.create(irToAsm.translator.prototype);
    that.asm = new x86.Assembler(x86.target.x86);
    that.asm.codeBlock.bigEndian = false;
    that.strings = {};
    that.stringNb = 0;
    that.fct = null;

    that.globalLabel = that.asm.labelObj("GLOBAL_PRELUDE");

    return that;
};
/** @private assembler object */
irToAsm.translator.prototype.asm = null;
/** @private known strings so far */
irToAsm.translator.prototype.strings = {};
irToAsm.translator.prototype.stringNb = 0;
/** generate the corresponding assembly code for this list of blocks */
irToAsm.translator.prototype.genFunc = function (fct, blockList)
{
    const that = this;

    // Maintain the function object throughoutt the translation
    // to have to information from register allocation 
    this.fct = fct;

    var block;
    var instrIt;
    var opnds;
    var i;

    function replace(opnd)
    {
        if (opnd instanceof ConstValue && opnd.isInt())
        {
            return $(opnd.value);
        } else if (opnd instanceof ConstValue && opnd.isUndef())
        {
            return irToAsm.config.UNDEFINED;
        } else if (opnd instanceof ConstValue && typeof opnd.value === "string" )
        {
            return $(that.stringValue(opnd.value));
        } else 
        {
            return opnd;
        }

    };


    // Assign a unique label to this function
    // if it doesn't exist
    this.func_prelude(this.label(fct, "<func \"" + fct.funcName + "\">"));
    this.func_init();

    for (i=0; i < blockList.length; ++i)
    {
        block = blockList[i]; 

        // Generate the asm label for the current block 
        this.asm.label(this.label(block, block.label));

        // Generate all the asm instructions for each IR
        // instructions
        for (var instrIt = block.getInstrItr(); 
             instrIt.valid(); 
             instrIt.next())
        {
            instr = instrIt.get();

            if (instr instanceof MoveInstr)
            {
                this.asm.mov(instr.uses[0], instr.uses[1]);
            } else
            {
                // Replace constants by immediate values
                opnds = instr.regAlloc.opnds.map(replace);

                this["ir_" + instr.mnemonic](opnds, instr);
            }
        }

        this.asm.genListing("");
    }
};

/** 
    @private
    Returns a label for the object. If a label was 
    previously defined, the same label will be returned.
*/
irToAsm.translator.prototype.label = function (obj, name)
{
    var label;
    // Assign a unique label to this obj 
    // if it doesn't exist
    if (obj.irToAsm === undefined)
    {
        obj.irToAsm = {};
    }

    label = obj.irToAsm.label;

    if (label === undefined)
    {
        label = ((name === undefined) ? this.asm.labelObj() : 
                                        this.asm.labelObj(name));
        obj.irToAsm.label = label;
    }

    return label;
};

/**
    @private
    Returns a representation of the string that fits into a register
*/
irToAsm.translator.prototype.stringValue = function (s)
{
    var value = this.strings[s];

    if (value === undefined)
    {
       value = this.stringNb++; 
       this.strings[s] = value;
    }

    return value;
};


irToAsm.translator.prototype.ir_lt = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;
    
    if (dest === null)
    {
        return;
    }

    var cont = this.asm.labelObj();

    if (opnds[0].type === x86.type.MEM &&
        opnds[1].type === x86.type.MEM)
    {
        this.asm.
        mov(opnds[0], dest). 
        cmp(dest, opnds[1]); 
    } else
    {
        this.asm.
        cmp(opnds[1], opnds[0]);
    }

    this.asm.
    mov(irToAsm.config.TRUE, dest).
    jl(cont).
    mov(irToAsm.config.FALSE, dest).
    label(cont);

};

irToAsm.translator.prototype.ir_if = function (opnds, instr)
{
    const targets = instr.targets;
    var true_label = this.label(targets[0]);
    var false_label = this.label(targets[1]);

    this.asm.
    cmp(irToAsm.config.TRUE, opnds[0]).
    je(true_label).
    jmp(false_label);

};

irToAsm.translator.prototype.ir_sub = function (opnds, instr)
{
    const that = this;
    const dest = instr.regAlloc.dest;

    if (dest === null)
    {
        return;
    }

    function xchg(opnd1, opnd2)
    {
        assert(!(opnd1.type === x86.type.MEM &&
                 opnd2.type === x86.type.MEM));

        assert(!opnd1.type === x86.type.IMM_VAL);
        assert(!opnd2.type === x86.type.IMM_VAL);
        
        that.asm.
        xor(opnd1, opnd2).
        xor(opnd2, opnd1).
        xor(opnd1, opnd2);
    };

    if (opnds[1] === dest && opnds[0].type !== x86.type.IMM_VAL)
    {
        xchg(opnds[1], opnds[0]);

        this.asm.sub(opnds[1], dest);

        xchg(opnds[1], opnds[0]);
    } else if (opnds[1] === dest && opnds[0].type === x86.type.IMM_VAL)
    {
        this.asm.
        mov(opnds[0], irToAsm.config.scratch).
        sub(opnds[1], irToAsm.config.scratch).
        mov(irToAsm.config.scratch, opnds[1]);
    } else if (opnds[0] === dest)
    {
        this.asm.
        sub(opnds[1], dest);
    } else
    {
        this.asm.
        mov(opnds[0], dest).
        sub(opnds[1], dest);
    }
};

irToAsm.translator.prototype.ir_add = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;

    if (dest === null)
    {
        return;
    }

    if (opnds[1] === dest)
    {
        this.asm.
        add(opnds[0], dest);
    } else if (opnds[0] === dest)
    {
        this.asm.
        add(opnds[1], dest);
    } else
    {
        this.asm.
        mov(opnds[0], dest).
        add(opnds[1], dest);
    }

};

irToAsm.translator.prototype.ir_get_prop_val = function (opnds, instr)
{
    const obj = opnds[0];
    const dest = instr.regAlloc.dest;

    if (dest === null)
    {
        return;
    }

    var cont = this.asm.labelObj();

    this.get_prop_addr(opnds, irToAsm.config.scratch);

    this.asm.
    cmp(irToAsm.config.NULL, irToAsm.config.scratch).
    je(cont).
    mov(mem(G_VALUE_OFFSET, irToAsm.config.scratch), irToAsm.config.scratch).

    label(cont).
    mov(irToAsm.config.scratch, dest);


};

irToAsm.translator.prototype.get_prop_addr = function (opnds, dest)
{
    const obj = opnds[0];
    const key = opnds[1];

    var loop = this.asm.labelObj();
    var end = this.asm.labelObj();
    var notFound = this.asm.labelObj();
    var cont = this.asm.labelObj();

    this.asm.
    mov(obj, irToAsm.config.scratch).
    add($(G_FIRST_OFFSET), irToAsm.config.scratch). // Retrieve address of first element
    add(mem(G_NEXT_OFFSET - G_FIRST_OFFSET, irToAsm.config.scratch), 
        irToAsm.config.scratch). // Retrieve beginning of next
    sub($(G_ENTRY_LENGTH), irToAsm.config.scratch).       // Move to last element

    label(loop).                        // Loop from end to beginning
    sub($(G_FIRST_OFFSET), irToAsm.config.scratch).
    cmp(obj, irToAsm.config.scratch).           
    jl(end).

    add($(G_FIRST_OFFSET), irToAsm.config.scratch).       // Address of current item
    cmp(key, mem(G_KEY_OFFSET, irToAsm.config.scratch), G_KEY_WIDTH).   // global[index] === key ?
    je(cont).                         // Item found on equal!

    sub($(G_ENTRY_LENGTH), irToAsm.config.scratch).      // move to next value
    jmp(loop).

    label(end).
    mov(irToAsm.config.NULL, irToAsm.config.scratch).        // no value found

    label(cont).
    mov(irToAsm.config.scratch, dest);

};

irToAsm.translator.prototype.ir_put_prop_val = function (opnds, instr)
{
    const obj = opnds[0];
    const key = opnds[1];
    const value = opnds[2];

    var loop = this.asm.labelObj();
    var found = this.asm.labelObj();

    this.get_prop_addr(opnds, irToAsm.config.scratch);

    this.asm.
    cmp(irToAsm.config.NULL, irToAsm.config.scratch).
    jne(found).
    mov(obj, irToAsm.config.scratch).
    add($(G_FIRST_OFFSET), irToAsm.config.scratch).          // Retrieve address of first element
    add(mem(G_NEXT_OFFSET, obj), irToAsm.config.scratch). // Retrieve address of next element 
    // Inc entry nb
    add($(G_ENTRY_LENGTH), mem(G_NEXT_OFFSET, obj), G_NEXT_OFFSET_WIDTH). 
    mov(key, mem(G_KEY_OFFSET, irToAsm.config.scratch), G_KEY_WIDTH).     // Add entry key
    label(found).                          
    mov(value, mem(G_VALUE_OFFSET, irToAsm.config.scratch), G_VALUE_WIDTH); // Add/Update the entry value

};

irToAsm.translator.prototype.dump_global_object = function ()
{
    this.asm.
    label(this.globalLabel);

    this.call_self();

    this.asm.
    gen32(0); // Length
   
    for (var i=0; i < irToAsm.config.maxGlobalEntries; ++i)
    {
        this.asm.
        gen32(0). // Reserved space for key
        gen32(0); // Reserved space for value
    }
    this.asm.genListing("GLOBAL_OBJECT");
    
};

irToAsm.translator.prototype.call_self = function (offset)
{
    if (offset === undefined)
    {
        offset = 5;
    }
    const SELF = this.asm.labelObj();

    this.asm.
    call(SELF).
    label(SELF).
    pop(EAX).
    add($(offset),EAX).
    ret().
    genListing("ADDR RETRIEVAL");

};

irToAsm.translator.prototype.ir_arg = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;
    const argIndex = instr.argIndex;

    if (dest === null)
    {
        return;
    }

    if ((dest !== irToAsm.config.funcObjReg && argIndex === 0) ||
        (dest !== irToAsm.config.thisObjReg && argIndex === 1) ||
        (dest !== irToAsm.config.argsReg[argIndex - 2] && argIndex >= 2))
    {
        error("ir_arg: dest register '" + dest + 
              "' unexpected for argument index '" + argIndex + "'");
    }
    

};

irToAsm.translator.prototype.ir_ret = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;
    const spillNb = this.fct.regAlloc.spillNb;

    this.asm.add($(spillNb*4), irToAsm.config.stack);

    if (opnds[0] !== EAX)
    {
        this.asm.mov(opnds[0], EAX);
    }
   
    //this.asm.mov(mem(0,irToAsm.config.stack), EBX);
    //this.asm.jmp(EBX);
    this.asm.ret();
};

irToAsm.translator.prototype.ir_call = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;
    const targets = instr.targets;
    const that = this;

    var spillNb = opnds.length - 4;
    var offset = 1;
    var i;
    var continue_label = this.label(targets[0], targets[0].label);

    if (spillNb < 0)
    {
        spillNb = 0;
    }

    offset = (spillNb) * 4;

    // Move arguments in the right registers
    var map = allocator.mapping();

    if (opnds[0] !== irToAsm.config.funcObjReg)
    {
        map.add(opnds[0], irToAsm.config.funcObjReg);
    }
    
    if (opnds[1] !== irToAsm.config.thisObjReg)
    {
        map.add(opnds[1], irToAsm.config.thisObjReg);
    }

    for (i=2; i < 3 && i < opnds.length; ++i)
    {

        if (opnds[i] !== irToAsm.config.argsReg[i - 2])
        {
            map.add(opnds[i], irToAsm.config.argsReg[i - 2]);
        }
    }

    map.orderAndInsertMoves( function (move)
                             {
                                that.asm.mov(move.uses[0], move.uses[1]);
                             }, irToAsm.config.scratch);
   

    // Add extra arguments on the stack
    if (spillNb > 0)
    {
        error("TODO");
    }

    this.asm.
    // Add stack frame descriptor space
    // TODO

    // Add return address
    /*
    mov(EAX, irToAsm.config.scratch);

    this.call_self(15).

    this.asm.
    mov(EAX, mem(-(offset), irToAsm.config.stack)).
    mov(irToAsm.config.scratch, EAX).
    */

    // Move pointers on top of extra args
    sub($(offset), irToAsm.config.stack).

    // Call function address
    call(EAX).

    // Remove return address and extra args
    add($(offset), irToAsm.config.stack).

    // Jump to continue_label
    jmp(continue_label);

};

irToAsm.translator.prototype.func_prelude = function (prelude_label)
{
    // Add the call self instructions to retrieve
    // the address of the function
    this.asm.
    label(prelude_label);
    
    this.call_self(9);
    
    // Reserve space for the global object associated
    // with this function
    this.asm.
    gen32(0).
    genListing("FUNC GLOBAL OBJ");


};

irToAsm.translator.prototype.func_init = function ()
{
    var spillNb = this.fct.regAlloc.spillNb;

    this.asm.sub($(spillNb*4), irToAsm.config.stack);
};

irToAsm.translator.prototype.ir_make_arg_obj = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;
    assert(dest === null);
    // For now, let's ignore the argument object

};

irToAsm.translator.prototype.ir_make_clos = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;

    if (dest === null)
    {
        return;
    }

    assert(opnds[0] instanceof IRFunction); 

    var fctLabel = this.label(opnds[0]);

    if (dest === EAX)
    {
        this.asm.
        call(fctLabel).
        mov(opnds[1], mem(-4, EAX));
    } else 
    {
        this.asm.
        mov(EAX, irToAsm.config.scratch).
        call(fctLabel).
        mov(EAX, dest).
        mov(irToAsm.config.scratch, EAX).
        mov(dest, irToAsm.config.scratch).

        // Store the global object in the function prelude
        mov(opnds[1], mem(-4, irToAsm.config.scratch));
    }

};

irToAsm.translator.prototype.ir_get_global = function (opnds, instr)
{
    const dest = instr.regAlloc.dest;

    if (dest === null)
    {
        return;
    }

    if (opnds[0].type === x86.type.REG)
    {
        this.asm.
        mov(mem(-4, opnds[0]), dest);
    } else if (opnds[0].type === x86.type.MEM)
    {
        this.asm.
        mov(opnds[0], irToAsm.config.scratch).
        mov(mem(-4, irToAsm.config.scratch), dest);
    }

};

irToAsm.translator.prototype.init = function (mainFct)
{
    const ret = this.asm.labelObj("MAIN RET");
    const fakeInstr1 = {regAlloc:{dest:EAX}};

    const fakeBlock = {irToAsm:{label:ret}};
    const fakeInstr2 = {regAlloc:{dest:EAX}, targets:[fakeBlock]};

    this.label(mainFct, "<func MAIN>");

    this.asm.
    genListing("INIT").
    // Move global object address in global register 
    call(this.globalLabel).
    mov(EAX, EBX);

    // Setup the main function
    this.ir_make_clos([mainFct, EBX], fakeInstr1);

    // Call the main function
    this.ir_call([EAX, EBX], fakeInstr2);

    // Return from the main function
    this.asm.
    label(ret).
    ret();

    // Add the global object dump at the end of the init section
    this.dump_global_object();

};


})(); // end of local namespace
